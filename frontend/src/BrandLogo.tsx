import logoUrl from '../Logo Design.svg?url';

/** The supplied artwork, cropped with CSS for the compact header mark. */
export function BrandLogo({full=false}:{full?:boolean}){
  return full?<img className="splash-logo" src={logoUrl} alt="SIGAP" width="240" height="240" fetchPriority="high"/>:
    <span className="brand-mark" aria-hidden="true"><img src={logoUrl} alt="" width="100" height="100"/></span>;
}
