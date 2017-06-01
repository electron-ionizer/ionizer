export const BASE = 'https://localhost:1234';

export const expectRejection = (p: Promise<any>) => {
    return new Promise((resolve, reject) => {
        p.then(() => reject('Expected promise to be rejected')).catch(() => resolve());
    });
};
