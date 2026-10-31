import { ClipboardCheck, TriangleAlert, CheckCircle2, ChevronRight } from 'lucide-react';
import type { Shelter } from './demo';
import { StatusHelp } from './StatusHelp';
import { qualityLabel } from './presentation';
import { reviewSummary } from './reviewIndicators';

const statuses = [
    { label: 'Perlu klarifikasi', color: '#d97706' },
    { label: 'Parsial', color: '#64748b' },
    { label: 'Siap ditinjau', color: '#059669' },
] as const;

export function StatusPie({
    shelters,
    selected,
    onSelect,
    compact = false,
    onSelectShelter,
}: {
    compact?: boolean;
    shelters: Shelter[];
    selected: string;
    onSelect: (status: string) => void;
    onSelectShelter?: (s: Shelter) => void;
}) {
    const display = (status: string) => status === 'Parsial' ? 'Data belum lengkap' : status === 'Siap ditinjau' ? 'Siap diperiksa' : status;
    const counts = statuses.map(s => ({ ...s, count: shelters.filter(row => qualityLabel(row) === display(s.label)).length }));
    let cursor = -Math.PI / 2;
    const slices = counts.filter(s => s.count > 0).map(s => {
        const start = cursor, angle = s.count / shelters.length * Math.PI * 2; cursor += angle;
        const point = (a: number) => `${80 + 65 * Math.cos(a)},${80 + 65 * Math.sin(a)}`;
        return { ...s, path: `M80,80 L${point(start)} A65,65 0 ${angle > Math.PI ? 1 : 0},1 ${point(cursor)} Z` };
    });
    const select = (status: string) => onSelect(selected === status ? 'Semua status' : status);

    const totalPeople = shelters.reduce((sum, s) => sum + (s.people ?? 0), 0);
    const vulnerableTotals = [
        { label: 'Balita', key: 'toddler' as const, color: '#2563eb' },
        { label: 'Lansia', key: 'elderly' as const, color: '#d97706' },
        { label: 'Ibu hamil', key: 'pregnant' as const, color: '#be185d' },
        { label: 'Disabilitas', key: 'disability' as const, color: '#7c3aed' },
    ].map(g => {
        let val = 0, known = false;
        for (const s of shelters) {
            const v = s[g.key];
            if (typeof v === 'number' && Number.isFinite(v) && v >= 0) { val += v; known = true; }
        }
        return { ...g, value: known ? val : null };
    });

    const urgentShelters = shelters.filter(s => qualityLabel(s) !== 'Siap diperiksa');

    return <section className={`status-overview recap-status-pie${compact ? ' compact-status-pie' : ''}`} aria-label={compact ? 'Status pemeriksaan seluruh posko' : 'Status Pemeriksaan Posko'}>
        <header className="status-overview-heading">{!compact && <span className="status-overview-icon"><ClipboardCheck size={21} aria-hidden="true" /></span>}<div className="status-overview-title"><div className="status-heading"><h3>{compact ? 'Status pemeriksaan' : 'Status Pemeriksaan Posko'}</h3><StatusHelp /></div>{!compact && <p>Proporsi status dari seluruh posko dalam rekap.</p>}</div></header>
        <div className="status-chart-layout">
            <div className="status-pie-visual" role="img" aria-label={shelters.length ? `Sebaran status ${shelters.length} posko: ${counts.map(s => `${display(s.label)} ${s.count}`).join(', ')}` : 'Belum ada data status posko'}>
                <svg viewBox="0 0 160 160" aria-hidden="true">{!shelters.length ? <circle cx="80" cy="80" r="65" fill="var(--neutral-bg)" /> : slices.map(s => s.count === shelters.length ? <circle key={s.label} cx="80" cy="80" r="65" fill={s.color} className="status-pie-slice" onClick={() => select(s.label)} /> : <path key={s.label} d={s.path} fill={s.color} stroke="var(--surface)" strokeWidth="2" className="status-pie-slice" onClick={() => select(s.label)} />)}{!compact && <circle cx="80" cy="80" r="42" fill="var(--surface)" pointerEvents="none" />}{!compact && <><text x="80" y="78" textAnchor="middle" className="status-pie-total" pointerEvents="none">{shelters.length}</text><text x="80" y="96" textAnchor="middle" className="status-pie-caption" pointerEvents="none">posko</text></>}</svg>
            </div>
            <ul className="status-chart-legend" aria-label="Jumlah posko per status">{counts.map(s => <li key={s.label}><button type="button" aria-pressed={selected === s.label} aria-label={`${display(s.label)}: ${s.count} posko`} onClick={() => select(s.label)}><span className="status-legend-label"><i aria-hidden="true" style={{ background: s.color }} />{display(s.label)}</span><span className="status-legend-value"><strong>{s.count}</strong><small>{shelters.length ? `${(s.count / shelters.length * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '—'}</small></span></button></li>)}</ul>
        </div>

        {!compact && (
            <div className="recap-status-expanded-details">
                <div className="recap-vulnerable-section">
                    <div className="recap-subheading-row">
                        <h4>Kelompok rentan terdata</h4>
                        <small>{totalPeople.toLocaleString('id-ID')} jiwa total</small>
                    </div>
                    <div className="recap-vulnerable-grid">
                        {vulnerableTotals.map(g => (
                            <div key={g.label} className="recap-vulnerable-pill">
                                <span className="recap-vulnerable-dot" style={{ background: g.color }} aria-hidden="true" />
                                <div className="recap-vulnerable-meta">
                                    <span className="recap-vulnerable-label">{g.label}</span>
                                    <strong className="recap-vulnerable-val">
                                        {g.value !== null ? `${g.value.toLocaleString('id-ID')} jiwa` : '—'}
                                        {g.value !== null && totalPeople > 0 && <small className="recap-vulnerable-pct">({(g.value / totalPeople * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%)</small>}
                                    </strong>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {!compact && <p className="status-overview-note">Pilih irisan atau label status untuk menyaring tabel utama. Pilih lagi untuk menampilkan semua status. Status menunjukkan kelengkapan data, bukan tingkat kedaruratan.</p>}
    </section>;
}
