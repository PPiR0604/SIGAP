import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verificationReturn} from '../src/verificationReturn.ts';

test('old verification links direct to password sign-in without echoing URL contents',()=>{
 const result=verificationReturn('http://localhost:5173/#error=access_denied&error_code=otp_expired&error_description=private-secret');
 assert.equal(result.isCallback,true);assert.equal(result.error,'');assert.match(result.message,/Silakan masuk/);assert.ok(!JSON.stringify(result).includes('private-secret'));
});
test('credential fragments produce a sign-in notice, never a session or copied token',()=>{
 const result=verificationReturn('http://localhost:5173/#access_token=secret-access&refresh_token=secret-refresh&type=signup');
 assert.equal(result.isCallback,true);assert.match(result.message,/Silakan masuk/);assert.ok(!JSON.stringify(result).includes('secret-'));
 assert.equal(verificationReturn('http://localhost:5173/#laporan').isCallback,false);
});
