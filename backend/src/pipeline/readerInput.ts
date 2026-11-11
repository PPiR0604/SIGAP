/** Negotiate transport only; all records, provenance and verification stay intact. */
export function storageReaderInput(description:string|undefined,includeCalculation=false){
 return {action:'all',
  ...(includeCalculation&&description?.includes('sigap:validated-calculation-v1')?{include_calculation:true}:{}),
  ...(description?.includes('sigap:compact-read-result-v1')?{response_format:'compact'}:{}),
 };
}
