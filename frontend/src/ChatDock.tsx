import {useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowRight,ChevronDown,ChevronUp,Paperclip} from 'lucide-react';
import {ChatMarkdown} from './ChatMarkdown';

interface ChatDockProps{
  messages:{role:'user'|'assistant';text:string}[];
  input:string;
  onInput:(value:string)=>void;
  onSend:()=>void;
  onUpload:()=>void;
  processing:boolean;
  dispatching:boolean;
  composerRef:React.RefObject<HTMLTextAreaElement|null>;
  statusText?:string;
  suggestions?:{label:string;text:string}[];
  onSuggest?:(text:string)=>void;
}

// Kartu chat biasa di dalam halaman (tidak melayang), supaya tidak menutupi konten.
export function ChatDock({messages,input,onInput,onSend,onUpload,processing,dispatching,composerRef,statusText,suggestions=[],onSuggest}:ChatDockProps){
  const [expanded,setExpanded]=useState(messages.length>0);
  const [unread,setUnread]=useState(false);
  const history=useRef<HTMLDivElement>(null);
  const followLatest=useRef(true);
  const previousCount=useRef(messages.length);
  function latest(){if(history.current)history.current.scrollTop=history.current.scrollHeight;followLatest.current=true;setUnread(false);}
  useEffect(()=>{
    if(!previousCount.current&&messages.length)setExpanded(true);
    previousCount.current=messages.length;
    if(expanded){if(followLatest.current)latest();else setUnread(true);}
  },[messages,expanded]);
  useEffect(()=>{
    const el=composerRef.current;
    if(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,200)+'px';}
  },[input,composerRef]);
  function send(){if(!input.trim()||dispatching)return;setExpanded(true);followLatest.current=true;onSend();}
  return <section className="chat-dock" aria-label="Percakapan dengan Agent">
    <div className="chat-dock-heading">
      <div><h2>Chat dengan Agent</h2><span role="status">{processing?(statusText||'Sedang memproses…'):'Asisten laporan lapangan'}</span></div>
      {messages.length>0&&<button type="button" className="button quiet chat-toggle" aria-label={expanded?'Ciutkan percakapan':'Buka percakapan'} aria-expanded={expanded} aria-controls="chat-dock-history" onClick={()=>setExpanded(v=>!v)}>{expanded?<>Sembunyikan<ChevronUp size={16} aria-hidden="true"/></>:<>Tampilkan ({messages.length})<ChevronDown size={16} aria-hidden="true"/></>}</button>}
    </div>
    {messages.length===0&&!processing&&suggestions.length>0&&<div className="chat-chips" role="group" aria-label="Saran pesan">{suggestions.map(s=><button key={s.label} type="button" className="chip" onClick={()=>onSuggest?.(s.text)}>{s.label}</button>)}</div>}
    <div className="chat-dock-input">
      <label className="sr-only" htmlFor="report-input">Laporan atau pertanyaan Anda</label>
      <div className="chat-composer">
        <textarea id="report-input" ref={composerRef} rows={3} placeholder="Tempel laporan lapangan di sini, atau tanyakan sesuatu ke Agent…" value={input} onChange={e=>onInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/>
        <div className="chat-actions">
          <button type="button" className="button quiet" onClick={onUpload} aria-label="Unggah laporan"><Paperclip size={17} aria-hidden="true"/>Unggah .txt / .csv</button>
          <span className="chat-hint">Ctrl / ⌘ + Enter</span>
          <button type="button" className="button primary chat-send" disabled={!input.trim()||dispatching} onClick={send}>Kirim<ArrowRight size={16} aria-hidden="true"/></button>
        </div>
      </div>
    </div>
    <div id="chat-dock-history" className="chat-dock-body" hidden={!expanded||messages.length===0&&!processing}>
      <div className="chat-history" ref={history} role="log" aria-label="Riwayat percakapan" onScroll={()=>{const el=history.current;if(el){followLatest.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;if(followLatest.current)setUnread(false);}}}>
        {messages.map((message,i)=><article key={i} className={`chat-message ${message.role}`}><span>{message.role==='user'?'Anda':'SIGAP · Agent'}</span>{message.role==='assistant'?<ChatMarkdown text={message.text}/>:<p>{message.text}</p>}</article>)}
        {processing&&<p className="chat-dock-processing" role="status"><span className="typing" aria-hidden="true"><i/><i/><i/></span>{statusText||'Agent sedang memproses…'}</p>}
      </div>
      {unread&&<button className="chat-dock-latest" onClick={latest}><ArrowDown size={14} aria-hidden="true"/>Pesan terbaru</button>}
    </div>
  </section>;
}
