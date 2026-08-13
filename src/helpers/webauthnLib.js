// Thin re-export of @simplewebauthn/server. Its CJS interop exposes
// non-configurable/non-writable properties (an ESM-package quirk), which
// sinon can't stub directly ("property descriptor" error). Wrapping each
// function in a plain object literal gives ordinary writable properties
// that tests CAN stub, without changing any call-site behavior.
const simplewebauthn = require('@simplewebauthn/server')

module.exports = {
  generateRegistrationOptions: (...args) => simplewebauthn.generateRegistrationOptions(...args),
  verifyRegistrationResponse: (...args) => simplewebauthn.verifyRegistrationResponse(...args),
  generateAuthenticationOptions: (...args) => simplewebauthn.generateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args) => simplewebauthn.verifyAuthenticationResponse(...args)
}
