import { expect } from 'chai';
import * as fetchMock from 'fetch-mock';

import Ionizer from '../src'
import { BASE, expectRejection } from './util';

describe('public key', () => {
    let instance: Ionizer;
    let mock: typeof fetchMock;

    beforeEach(() => {
        mock = (<any>fetchMock).sandbox();
        mock.get('end:/rest/healthcheck', { alive: true });
        instance = new Ionizer(BASE, mock);
    });

    it('should send a request to /rest/public', async () => {
        mock.get('*', {});
        await instance.getPublicKey();
        expect(mock.lastUrl()).to.equal(`${BASE}/rest/public`);
    });

    it('should throw an error if the request fails', async () => {
        mock.get('end:/rest/public', 500);
        await expectRejection(instance.getPublicKey());
    });

    it('should return the public key string when the request succeeds', async () => {
        mock.get('end:/rest/public', { key: 'top secret key' });
        const key = await instance.getPublicKey();
        expect(key).to.equal('top secret key');
    });
});
