import {Button,type ButtonProps} from '@/components/base/buttons/button';
import {cx} from '@/utils/cx';

/** Keeps native form/click behavior while existing SIGAP actions adopt BoardUI. */
export function ActionButton({className='',variant,type='submit',...props}:ButtonProps){
  const names=className.split(/\s+/);
  const resolved=variant??(names.includes('primary')?'primary':names.includes('secondary')?'secondary':names.includes('danger')?'danger':'ghost');
  const layout=names.filter(name=>!['primary','secondary','quiet','danger'].includes(name)).join(' ');
  return <Button {...props} type={type} variant={resolved} data-variant={resolved} className={cx('sigap-action',layout)}/>;
}
