import {useEffect,useRef} from 'react';
import {t,useLanguage} from './workbenchState';
import {documentationPath} from './sitePaths';
import './helpMenu.css';

export function HelpMenu({onQuickGuide}:{onQuickGuide:()=>void}){
  const code=useLanguage(),menu=useRef<HTMLDetailsElement>(null),licenseDialog=useRef<HTMLDialogElement>(null);
  const close=(focus=false)=>{if(menu.current){menu.current.open=false;if(focus)menu.current.querySelector('summary')?.focus();}};
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!menu.current?.contains(event.target))close();};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[]);
  return <><details className="header-dropdown pose-help-menu" ref={menu}
    onToggle={event=>{const current=event.currentTarget;if(current.open)current.closest('.topbar')?.querySelectorAll<HTMLDetailsElement>('details.header-dropdown[open]').forEach(other=>{if(other!==current)other.open=false;});}}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))close();}}
    onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close(true);}}}>
    <summary className="momo-header-button" data-momo-header-control="true" role="button"><span className="momo-header-label">{t('header.help')}</span></summary>
    <nav className="header-dropdown-panel" aria-label={t('pose.helpMenu')}>
      <button type="button" onClick={()=>{close(true);onQuickGuide();}}>{t('pose.quickGuide')}</button>
      <a href={documentationPath('index',code)} target="_blank" rel="noopener noreferrer" onClick={()=>close(true)}>{t('pose.manual')} ↗</a>
      <a href={documentationPath('faq',code)} target="_blank" rel="noopener noreferrer" onClick={()=>close(true)}>{t('pose.faq')} ↗</a>
      <button type="button" onClick={()=>{close(true);licenseDialog.current?.showModal();}}>{t('pose.licensing')}</button>
      <hr/>
      <a href="https://github.com/BreezyMomo/MomoPoseForge" target="_blank" rel="noopener noreferrer" onClick={()=>close(true)}>{t('pose.repository')} ↗</a>
    </nav>
  </details>
  <dialog ref={licenseDialog} className="help-dialog" aria-labelledby="pose-license-title" onKeyDown={event=>event.stopPropagation()}>
    <div className="dialog-header"><h2 id="pose-license-title">{t('pose.licensing')}</h2></div>
    <p>{t('pose.programLicense')}</p><p>{t('pose.outputLicense')}</p><p>{t('pose.thirdPartyLicense')}</p>
    <p><a href="https://spdx.org/licenses/GPL-3.0-only.html" target="_blank" rel="noopener noreferrer">GPL-3.0-only ↗</a> · <a href="https://opensource.org/license/mit" target="_blank" rel="noopener noreferrer">MIT ↗</a></p>
    <button type="button" className="primary-button" onClick={()=>licenseDialog.current?.close()}>{t('pose.closeLicense')}</button>
  </dialog></>;
}
