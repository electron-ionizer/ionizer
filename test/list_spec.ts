import { expect, use } from 'chai';
import * as fetchMock from 'fetch-mock';

import Ionizer from '../src'
import { BASE, expectRejection } from './util';

describe('list plugins', () => {
    let instance: Ionizer;
    let mock: typeof fetchMock;

    beforeEach(() => {
        mock = (<any>fetchMock).sandbox();
        mock.get('end:/rest/healthcheck', { alive: true });
        instance = new Ionizer(BASE, mock);
    });

    it('should send a request to /rest/plugin', async () => {
        mock.get('*', []);
        await instance.getPlugins();
        expect(mock.lastUrl()).to.equal(`${BASE}/rest/plugin`);
    });

    it('should throw an error if the request fails', async () => {
        mock.get('end:/rest/plugin', 500);
        await expectRejection(instance.getPlugins());
    });

    it('should return the plugins when the request succeeds', async () => {
        mock.get('end:/rest/plugin', [{ name: 'Foo Bar Plugin', versions: [] }]);
        const plugins = await instance.getPlugins();
        expect(plugins).to.deep.equal([{ name: 'Foo Bar Plugin', versions: [] }]);
    });

    it('should return the plugin versions sorted if the request succeeds', async () => {
        mock.get('end:/rest/plugin', [{ name: 'Foo Bar Plugin', versions: [{ version: '0.0.2'}, { version: '0.0.1' }] }]);
        const plugins = await instance.getPlugins();
        expect(plugins).to.deep.equal([{ name: 'Foo Bar Plugin', versions: [{ version: '0.0.1'}, { version: '0.0.2' }] }]);
    });
});
