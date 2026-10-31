import logoUrl from './assets/sigap-logo.png?url';

/** Original embedded brand image, extracted and losslessly recompressed for delivery. */
export function BrandLogo({full=false}:{full?:boolean}){
  return full?<img className="splash-logo" src={logoUrl} alt="SIGAP" width="240" height="240" fetchPriority="high"/>:
    <span className="brand-mark" aria-hidden="true"><img src={logoUrl} alt="SIGAP" width="36" height="36"/></span>;
}
