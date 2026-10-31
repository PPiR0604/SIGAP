import {useState} from 'react';
import {storedRows} from './backendPreview';
import type {Shelter} from './demo';
import {sourceFingerprint} from './presentation';
export type BulletinSource={rows:Shelter[];records?:Record<string,any>[];snapshotId:string;generatedAt?:string;contextName?:string;stored:boolean;fingerprint:string};
export function useBulletinSource(){const [source,setSource]=useState<BulletinSource|null>(null);function receive(data:any,rows:Shelter[]){const records=data.source_metadata?.records||data.records;const used=Array.isArray(records)?storedRows(records):[];setSource({rows:used,records:Array.isArray(records)?records:[],snapshotId:data.source_metadata?.snapshot_id||data.snapshot_id||'',generatedAt:data.source_metadata?.generated_at||data.generated_at,contextName:typeof data.source_metadata?.context_name==='string'?data.source_metadata.context_name:undefined,stored:data.source_metadata?.kind==='stored',fingerprint:sourceFingerprint(rows)});}return {source,receive};}
