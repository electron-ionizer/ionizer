import { app } from 'electron';
import { expect } from 'chai';
import * as fetchMock from 'fetch-mock';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as NodeRsa from 'node-rsa';

import Ionizer from '../src'
import { BASE, expectRejection } from './util';

const fakePluginData = [
    {
        id: 'id1',
        name: 'Fake Plugin 1',
        versions: [
            {
                version: '0.0.1',
                hash: 'hash001',
                validated: true,
            },
            {
                version: '0.0.2',
                hash: 'hash002',
                validated: true,
            },
        ],
    },
];

describe('installer', () => {
    const ionizerFolder = path.resolve(app.getPath('userData'), 'ionizer');
    let instance: Ionizer;
    let mock: typeof fetchMock;
    const key = (new NodeRsa({ b: 8 })).generateKeyPair();
    const publicKey = key.exportKey('public').toString();

    beforeEach(() => {
        mock = (<any>fetchMock).sandbox();
        mock.get('end:/rest/healthcheck', { alive: true });
        mock.get('end:/rest/public', { key: publicKey });
        instance = new Ionizer(BASE, mock);
        process.noAsar = true;
        (<any>global).IS_TESTING_IONIZER = true;
    });

    afterEach(() => {
        process.noAsar = false;
        (<any>global).IS_TESTING_IONIZER = false;
    })

    describe('list installed', () => {
        before(async () => {
            await fs.remove(ionizerFolder);
        });

        it('should create the ionizer folder', async () => {
            await instance.getInstalledPlugins();
            expect(await fs.pathExists(ionizerFolder)).to.equal(true);
        });

        it('should make the ionizer folder empty', async () => {
           expect(await fs.readdir(ionizerFolder)).to.have.length(0);
        });

        it('should store the plugin manifest the first time it is fetched', async () => {
            mock.get('end:/rest/plugin', [{ name: 'fake', versions: [{ validated: true }] }]);
            await instance.getPlugins();
            expect(await fs.readJSON(path.resolve(ionizerFolder, 'manifest.json'))).to.deep.equal([{ name: 'fake', versions: [{ validated: true }] }]);
        });

        it('should update the plugin manifest on sequentual fetches', async () => {
            mock.get('end:/rest/plugin', fakePluginData);
            await instance.getPlugins();
            expect(await fs.readJSON(path.resolve(ionizerFolder, 'manifest.json'))).to.deep.equal(fakePluginData);
        });

        it('should initially return an empty array', async () => {
            expect(await instance.getInstalledPlugins()).to.deep.equal([]);
        });
    });

    describe('install plugin', () => {
        let plugins;

        before(async () => {
            await fs.remove(ionizerFolder);
        });

        beforeEach(async () => {
            mock.get('end:/rest/plugin', fakePluginData);
            plugins = await instance.getPlugins();
        });

        it('should create the ionizer folder', async () => {
            mock.get('end:/download', key.encryptPrivate('file_content'));
            await instance.install(plugins[0]);
            expect(await fs.pathExists(ionizerFolder)).to.equal(true);
        });

        it('should create the plugin folder and store the version file', async () => {
            mock.get('end:/download', key.encryptPrivate('file_content'));
            await instance.install(plugins[0]);
            expect(await fs.pathExists(path.resolve(ionizerFolder, 'id1', 'hash002.asar'))).to.equal(true, 'expected plugin file to be installed');
            expect(await fs.readFile(path.resolve(ionizerFolder, 'id1', 'hash002.asar'), 'utf8')).to.equal('file_content');
        });

        it('should report the plugin version as installed', async () => {
            const installed = await instance.getInstalledPlugins();
            expect(installed).to.have.length(1);
            expect(installed[0].installedVersion.version).to.equal('0.0.2');
        });

        it('should report 0 updates available', async () => {
            const updates = await instance.getAvailableUpdates();
            expect(updates).to.have.length(0);
        });
    })

    describe('update plugin', () => {
        let plugins;

        before(async () => {
            await fs.remove(ionizerFolder);
        });

        beforeEach(async () => {
            mock.getOnce('end:/rest/plugin', fakePluginData);
            plugins = await instance.getPlugins();
        });

        it('should report no updates after a fresh install', async () => {
            mock.get('end:/download', key.encryptPrivate('file_content'));
            await instance.install(plugins[0]);
            mock.get('end:/rest/plugin', fakePluginData);
            expect(await instance.getAvailableUpdates()).to.have.length(0);
        });

        it('should report an update when a new version is available on the server', async () => {
            const newFakePluginData = Object.assign([], fakePluginData);
            newFakePluginData[0].versions.push({ version: '0.0.3', hash: 'hash003', validated: true });
            mock.get('end:/rest/plugin', newFakePluginData);
            expect(await instance.getAvailableUpdates()).to.have.length(1);
        });

        it('should not report an update once the latest version has been installed', async () => {
            const newFakePluginData = Object.assign([], fakePluginData);
            newFakePluginData[0].versions.push({ version: '0.0.3', hash: 'hash003' });
            mock.get('end:/rest/plugin', newFakePluginData);
            const updates = await instance.getAvailableUpdates();
            mock.get('end:/download', key.encryptPrivate('new_content'));
            await instance.update(updates[0]);
            expect(await instance.getAvailableUpdates()).to.have.length(0);
            expect(await fs.pathExists(path.resolve(ionizerFolder, 'id1', 'hash002.asar'))).to.equal(false, 'expected old plugin to be removed');
            expect(await fs.pathExists(path.resolve(ionizerFolder, 'id1', 'hash003.asar'))).to.equal(true, 'expected new plugin to exist');
            expect(await fs.readFile(path.resolve(ionizerFolder, 'id1', 'hash003.asar'), 'utf8')).to.equal('new_content');
        });

        it('should not report an update when a new version is available but not validated', async () => {
            const newFakePluginData = Object.assign([], fakePluginData);
            newFakePluginData[0].versions.push({ version: '0.0.4', hash: 'hash004', validated: false });
            mock.get('end:/rest/plugin', newFakePluginData);
            expect(await instance.getAvailableUpdates()).to.have.length(0);
        });

        it('should throw an error when update is given a normal plugin object', async () => {
            await expectRejection(instance.update(plugins[0]));
        });

        it('should throw an error when update is given an installed plugin object', async () => {
            await expectRejection(instance.update(await instance.getInstalledPlugins()[0]));
        });
    });
});
