/* Verifies that whole-ledger cloud writes cannot complete out of order.
   Run: node _verify_cloud_write_queue.js */
const fs = require('fs');

global.window = global;
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
global.state = { revision: 0 };
global.pendingCloudPushQueued = false;
global.updateAppStatus = function () {};
global.updateGoogleSyncStatus = function () {};
global.toGooglePayload = function () { return { state: { revision: state.revision } }; };
const writes = [];
global.SUPA = {
  configured: function () { return true; },
  user: { id: 'test-user' },
  sessionUser: async function () { return this.user; },
  saveLedger: async function (id, payload) {
    writes.push(payload.state.revision);
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
    return { ok: true };
  }
};

eval(fs.readFileSync('js/cloud.js', 'utf8'));

(async function () {
  state.revision = 1;
  const first = cloudPush();
  // Let the first request capture revision 1 and remain in flight, then make
  // a newer edit exactly as a fast second device/form event would.
  await new Promise(function (resolve) { setTimeout(resolve, 1); });
  state.revision = 2;
  const second = cloudPush();
  await Promise.all([first, second]);
  const pass = writes.length === 2 && writes[0] === 1 && writes[1] === 2;
  console.log(pass ? 'PASS ordered cloud-write queue preserves newest state' : 'FAIL writes: ' + JSON.stringify(writes));
  process.exit(pass ? 0 : 1);
})();
