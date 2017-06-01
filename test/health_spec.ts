import { expect } from 'chai';
import * as fetchMock from 'fetch-mock';

import Ionizer from '../src'
import { BASE } from './util';

describe('health check', () => {
    let instance: Ionizer;
    let mock: typeof fetchMock;

    beforeEach(() => {
        mock = (<any>fetchMock).sandbox();
        instance = new Ionizer(BASE, mock);
    });

    it('should send a request to /rest/healthcheck', async () => {
        mock.get('*', { alive: true });
        await instance.performHealthCheck();
        expect(mock.lastUrl()).to.equal(`${BASE}/rest/healthcheck`);
    });

    it('should return true if the healthcheck succeeds', async () => {
        mock.get('*', { alive: true });
        const result = await instance.performHealthCheck();
        expect(result).to.equal(true, 'Should return return true if the server response is true');
    });

    it('should return false if the healthcheck fails', async () => {
        mock.get('*', { alive: false });
        const result = await instance.performHealthCheck();
        expect(result).to.equal(false, 'Should return return false if the server response is false');
    });

    it('should return false if the healthcheck errors', async () => {
        mock.get('*', 500);
        const result = await instance.performHealthCheck();
        expect(result).to.equal(false, 'Should return return false if the server response is a non-200 code');
    });
});
