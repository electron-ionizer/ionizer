import { app } from 'electron';
import { default as fetch, Response } from 'node-fetch';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as semver from 'semver';
import * as NodeRsa from 'node-rsa';

export interface PluginVersion {
    version: string;
    fileIdentifier: string;
    hash: string;
    publishDate: Date;
    downloads: number;
    validated: boolean;
}

export interface Plugin {
    id: string;
    author: string;
    name: string;
    versions: PluginVersion[];
}

export interface InstalledPlugin extends Plugin {
    installedVersion: PluginVersion;
}

export interface UpdateablePlugin extends InstalledPlugin {
    nextVersion: PluginVersion;
}

interface HealthCheckResponse {
    alive: boolean;
}

interface PublicKeyResponse {
    key: string;
}

export default class Ionizer {
    private baseUrl: string;
    private fetchImpl: typeof fetch;

    constructor(baseUrl: string, fetchImpl?) {
        this.baseUrl = baseUrl;
        this.fetchImpl = fetchImpl || fetch;
    }

    get pluginRootDir() {
        return path.resolve(app.getPath('userData'), 'ionizer');
    }

    get manifestPath() {
        return path.resolve(this.pluginRootDir, 'manifest.json');
    }

    private constructRestUrl(...parts: string[]) {
        return `${this.baseUrl}/rest/${path.posix.join(...parts)}`;
    }

    private async json<T>(responsePromise: Promise<Response>): Promise<T> {
        return await (await responsePromise).json();
    }

    private async errorIfBadHealthCheck() {
        if (!await this.performHealthCheck()) {
            throw new Error('Plugin server is down, reported a unhealthy state');
        }
    }

    private async ensureLocalDir() {
        await fs.mkdirs(this.pluginRootDir);
    }

    private getVersionPath(plugin: Plugin, version: PluginVersion) {
        return path.resolve(this.pluginRootDir, plugin.id, `${version.hash}.asar`);
    }

    public async performHealthCheck() {
        try {
            const { alive } = await this.json<HealthCheckResponse>(this.fetchImpl(this.constructRestUrl('healthcheck')))
            return alive;
        } catch (err) {
            return false;
        }
    }

    public async getPublicKey() {
        await this.errorIfBadHealthCheck();
        const { key } = await this.json<PublicKeyResponse>(this.fetchImpl(this.constructRestUrl('public')));
        return key;
    }

    public async getPlugins() {
        await this.errorIfBadHealthCheck();
        let plugins = await this.json<Plugin[]>(this.fetchImpl(this.constructRestUrl('plugin')));
        for (const plugin of plugins) {
            plugin.versions.sort((a, b) => semver.compare(a.version, b.version));
            plugin.versions = plugin.versions.filter(version => version.validated);
        }
        plugins = plugins.filter(plugin => plugin.versions.length > 0);
        await this.ensureLocalDir();
        await fs.writeJSON(this.manifestPath, plugins);
        return plugins;
    }

    public async getInstalledPlugins() {
        await this.ensureLocalDir();
        let lastManifest: Plugin[] = [];
        const installed: InstalledPlugin[] = [];
        try {
            lastManifest = await fs.readJSON(this.manifestPath);
        } catch (err) {}
        for (const plugin of lastManifest) {
            if (!await fs.pathExists(path.resolve(this.pluginRootDir, plugin.id))) continue;
            let latestInstalled;
            for (const version of plugin.versions) {
                if (!await fs.pathExists(this.getVersionPath(plugin, version))) continue;
                latestInstalled = version;
            }
            if (latestInstalled) installed.push(Object.assign({}, plugin, { installedVersion: latestInstalled }));
        }
        return installed;
    }

    public async getAvailableUpdates() {
        const plugins = await this.getPlugins();
        const installed = await this.getInstalledPlugins();
        const updates: UpdateablePlugin[] = [];
        for (const plugin of installed) {
            const upstreamPlugin = plugins.find(upstreamPlugin => upstreamPlugin.id === plugin.id);
            if (!upstreamPlugin) continue;
            const update = upstreamPlugin.versions.reverse().find(upstreamVersion => semver.gt(upstreamVersion.version, plugin.installedVersion.version));
            if (update) {
                updates.push(Object.assign({}, plugin, { nextVersion: update }));
            }
        }
        return updates;
    }

    public async update(plugin: UpdateablePlugin) {
        if (!plugin.nextVersion || !plugin.installedVersion) {
            throw new Error('The plugin passed to update must be an updateable plugin returned from getAvailableUpdates');
        }
        const oldPath = this.getVersionPath(plugin, plugin.installedVersion);
        const tmpPath = `${oldPath}.old`;
        const newPath = this.getVersionPath(plugin, plugin.nextVersion);
        await fs.move(oldPath, tmpPath);
        try {
            await this.install(plugin);
        } catch (err) {
            if (await fs.pathExists(newPath)) await fs.remove(newPath);
            await fs.move(tmpPath, oldPath);
        }
        if (await fs.pathExists(tmpPath)) await fs.remove(tmpPath);
    }

    public async install(plugin: Plugin) {
        if (!plugin) {
            throw new Error('You must provide a plugin to the install method');
        }
        if (!plugin.versions.length) {
            throw new Error('The provided has plugin has no version to download');
        }
        const key = new NodeRsa();
        key.importKey(await this.getPublicKey());
        await this.ensureLocalDir();
        await this.errorIfBadHealthCheck();
        const version = plugin.versions[plugin.versions.length - 1];
        let buffer = await (await this.fetchImpl(this.constructRestUrl('plugin', plugin.id, 'version', version.hash, 'download'))).buffer();
        // For testing purposes
        // FIXME: This is stupidly bad but it's the best way I could get the tests actually "testing" :D
        if ((<any>global).IS_TESTING_IONIZER) {
            buffer = Buffer.from(JSON.parse(buffer.toString()).data);
        }
        const pluginFolder = path.resolve(this.pluginRootDir, plugin.id);
        await fs.mkdirs(pluginFolder);
        await fs.writeFile(this.getVersionPath(plugin, version), key.decryptPublic(buffer));
    }

    public async requirePlugin(plugin: InstalledPlugin) {
        if (!await fs.pathExists(this.getVersionPath(plugin, plugin.installedVersion))) {
            throw new Error('Can\'t require a plugin that is not installed');
        }
        return require(this.getVersionPath(plugin, plugin.installedVersion));
    }
}