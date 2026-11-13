import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preferredContext,rememberContext} from '../src/contextPreference.ts';

test('operation survives reload only for the same user and organization, within current assignments',()=>{
  const values=new Map<string,string>();
  const original=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}});
  try{
    const available=[{context_id:'demo'},{context_id:'trial'}];
    rememberContext('user-a','org-a','trial');
    assert.equal(preferredContext('user-a','org-a',available),'trial');
    assert.equal(preferredContext('user-b','org-a',available),'demo');
    assert.equal(preferredContext('user-a','org-b',available),'demo');
    assert.equal(preferredContext('user-a','org-a',[{context_id:'demo'}]),'demo');
    assert.equal(preferredContext('user-a','org-a',[]),'');
    rememberContext('user-a','org-a','');
    assert.equal(preferredContext('user-a','org-a',available),'demo');
  }finally{if(original)Object.defineProperty(globalThis,'sessionStorage',original);else Reflect.deleteProperty(globalThis,'sessionStorage');}
});

test('blocked browser storage does not prevent selecting an assigned operation',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw Error('blocked');}});
  try{
    rememberContext('u','o','trial');
    assert.equal(preferredContext('u','o',[{context_id:'demo'}]),'demo');
  }finally{if(original)Object.defineProperty(globalThis,'sessionStorage',original);else Reflect.deleteProperty(globalThis,'sessionStorage');}
});
