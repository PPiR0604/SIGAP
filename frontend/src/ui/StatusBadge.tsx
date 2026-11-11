import {Chip,type ChipProps} from '@/components/base/badges/chip';
import {cx} from '@/utils/cx';

export function StatusBadge({className='',color,...props}:ChipProps){
  const classes=className.split(/\s+/);
  const tone=color??(classes.includes('warning')?'yellow':classes.includes('success')?'lime':classes.includes('danger')?'rose':'soft');
  return <Chip {...props} variant="caption" color={tone} data-tone={tone} className={cx('badge sigap-status',classes.filter(c=>!['badge','warning','success','danger','neutral'].includes(c)).join(' '))}/>;
}
