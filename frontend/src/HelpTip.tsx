import {useEffect,useId,useRef,useState,type ReactNode,type KeyboardEvent} from 'react';
import {Info,FileSearch} from 'lucide-react';

/** Native popovers stay above scrolling panels and modal dialogs. */
export function HelpTip({label,children,source=false}:{label:string;children:ReactNode;source?:boolean}){
 const id=useId(),button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),pinned=useRef(false);
 const [open,setOpen]=useState(false);
 function cancelTimer(){clearTimeout(timer.current);}
 function position(){
  const tip=panel.current,anchor=button.current;if(!tip||!anchor)return;
  const rect=anchor.getBoundingClientRect(),bounds=tip.getBoundingClientRect();
  tip.style.left=`${Math.max(12,Math.min(rect.left,innerWidth-bounds.width-12))}px`;
  tip.style.top=`${Math.max(12,rect.bottom+8+bounds.height<=innerHeight-12?rect.bottom+8:rect.top-bounds.height-8)}px`;
 }
 function show(){cancelTimer();const tip=panel.current;if(!tip)return;if(!tip.matches(':popover-open'))tip.showPopover();position();}
 function hide(){cancelTimer();pinned.current=false;const tip=panel.current;if(tip?.matches(':popover-open'))tip.hidePopover();setOpen(false);}
 function leave(){cancelTimer();if(!pinned.current)timer.current=setTimeout(hide,140);}
 function escape(e:KeyboardEvent){if(e.key==='Escape'&&panel.current?.matches(':popover-open')){e.preventDefault();e.stopPropagation();hide();}}
 useEffect(()=>{window.addEventListener('sigap-page-changed',hide);return()=>{cancelTimer();window.removeEventListener('sigap-page-changed',hide);};},[]);
 useEffect(()=>{if(!open)return;window.addEventListener('resize',position);window.addEventListener('scroll',position,true);return()=>{window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);};},[open]);
 const Icon=source?FileSearch:Info;
 return <div className="help-tip" onKeyDown={escape}>
  <button ref={button} type="button" className="help-tip-button" aria-label={label} aria-expanded={open} aria-controls={id} aria-describedby={open?id:undefined}
   onPointerEnter={e=>{if(e.pointerType==='mouse')show();}} onPointerLeave={leave} onFocus={show}
   onBlur={e=>{if(!panel.current?.contains(e.relatedTarget as Node))hide();}}
   onClick={()=>{if(pinned.current)hide();else{pinned.current=true;show();}}}><Icon size={16} aria-hidden="true"/></button>
  <div ref={panel} id={id} popover="auto" role="tooltip" className="help-tip-content" onToggle={()=>{const visible=!!panel.current?.matches(':popover-open');setOpen(visible);if(!visible)pinned.current=false;}}
   onPointerEnter={cancelTimer} onPointerLeave={leave} onKeyDown={escape}
   onBlur={e=>{if(!panel.current?.contains(e.relatedTarget as Node)&&e.relatedTarget!==button.current)hide();}}>
   <strong className="help-tip-title">{label}</strong>{children}
  </div>
 </div>;
}
