var ring = require('ring-client-api');
async function main() {
    try {
        const r = new ring.RingApi({ refreshToken: 'asdf' });
        const p = await r.getProfile();
        console.log('Done')
    }
    catch (err) {
        console.log('Received error');
    }
}
main();
