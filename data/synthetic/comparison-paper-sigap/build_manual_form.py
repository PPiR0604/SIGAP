"""Build the blank paper-comparison form; no participant answers or study results."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import Table, TableStyle, Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'output/pdf/formulir-manual-uji-sigap.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = landscape(A4)
M = 36
WIDTH = W - 2*M
URL = 'https://indonesia.unfpa.org/sites/default/files/pub-pdf/bnpb_juklak_no_9_2023_data_terpilah.pdf'
c = canvas.Canvas(str(OUT), pagesize=(W,H))
c.setTitle('Lembar manual penelitian SIGAP - adaptasi variabel terpilih BNPB')
c.setAuthor('Tim SIGAP')
style = ParagraphStyle('header', fontName='Helvetica-Bold', fontSize=9, leading=11)

def text(x,y,s,size=9,bold=False):
    c.setFont('Helvetica-Bold' if bold else 'Helvetica',size)
    c.setFillColor(colors.black)
    c.drawString(x,y,s)

def line(y):
    c.setStrokeColor(colors.HexColor('#777777'))
    c.setLineWidth(.4)
    c.line(M,y,W-M,y)

def header(title):
    text(M,H-38,title,17,True)
    text(M,H-55,'ADAPTASI PENELITIAN - BUKAN FORMULIR RESMI BNPB',9,True)
    text(M,H-77,'Kode peserta: __________________  Paket: __________  Tanggal: __________________')

def table(y,headers,widths,height):
    data=[[Paragraph(h,style) for h in headers]] + [['']*len(headers) for _ in range(3)]
    t=Table(data,colWidths=[WIDTH*x for x in widths],rowHeights=[30]+[height]*3)
    t.setStyle(TableStyle([
        ('GRID',(0,0),(-1,-1),.5,colors.HexColor('#666666')),
        ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eeeeee')),
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('LEFTPADDING',(0,0),(-1,-1),7),
        ('RIGHTPADDING',(0,0),(-1,-1),7),
    ]))
    tw,th=t.wrap(WIDTH,H)
    assert abs(tw-WIDTH)<1 and y-th>100
    t.drawOn(c,M,y-th)
    return y-th

def footer(page):
    line(49)
    text(M,36,'Rujukan variabel: BNPB Juklak 9/2023, Format 2 (h.28-29) dan Format 3 (h.37); lihat REFERENSI-FORMAT.md.',8)
    text(M,24,'Tata letak, kolom stok terukur dan lembar jawaban disusun untuk penelitian. Versi 10 November 2026.',8)
    text(W-M-42,24,f'{page} / 2',8)

header('REKAP PENGUNGSI DAN KEBUTUHAN - LEMBAR MANUAL')
text(M,H-96,'Lokasi pos lapangan / ruang uji: __________________________  Pembaruan terakhir: __________________')
text(M,476,'1. REKAP PENGUNGSI',10,True)
table(465,['Nama tempat pengungsian / posko','Desa / kelurahan','Waktu laporan','Total jiwa','Laki-laki','Perempuan'],[.25,.22,.15,.13,.125,.125],30)
text(M,328,'2. KEBUTUHAN DAN PERSEDIAAN AIR',10,True)
table(317,['Posko dan desa','Kebutuhan yang dilaporkan','Stok air (L)','Waktu stok dicek','Periode stok (jam)','Keterangan / belum diketahui'],[.23,.22,.10,.15,.12,.18],31)
text(M,174,'3. CATATAN PEMBARUAN / MASALAH YANG PERLU DIKLARIFIKASI',10,True)
text(M,160,'Ruang bebas bila diperlukan; tidak wajib membuat log tambahan di luar kebiasaan pencatatan.',8)
for y in [143,124]: line(y)
text(M,104,'0 = dilaporkan nol. BD / ? = belum diketahui. Jangan menebak informasi yang belum dilaporkan.',9)
text(M,88,'Waktu laporan berbeda dari waktu stok dicek. Isi periode stok sesuai sumber; bukan otomatis 24 jam.',9)
text(M,72,'Jumlah KK, rincian umur dan kelompok rentan tidak diminta dalam paket tugas ini.',8)
footer(1)
c.showPage()

header('LEMBAR JAWABAN DAN CATATAN SERAH TERIMA')
text(M,H-96,'Acuan latihan untuk kedua metode: 15 liter air per orang per 24 jam. Gunakan rekap yang Anda tetapkan final.',9)
text(M,476,'4. JAWABAN T04 - JAWAB SESUAI KARTU PAKET',10,True)
questions=[
 '1. Jumlah posko dan total jiwa terkini:',
 '2. Kebutuhan air seluruh posko untuk 24 jam:',
 '3. Kekurangan air posko pertama yang ditanyakan:',
 '4. Kekurangan air posko kedua yang ditanyakan:',
 '5. Apakah kekurangan air posko ketiga dapat ditentukan? Jelaskan:',
 '6. Perbedaan informasi stok nol dan stok belum diketahui pada dua posko yang ditanyakan:',
]
y=455
for q in questions:
    text(M,y,q,9)
    line(y-23)
    y-=42
text(M,196,'5. CATATAN SERAH TERIMA T05',10,True)
text(M,181,'Maksimal 150 kata atau butir informasi setara, sesuai permintaan pada kartu tugas. Jangan gunakan kunci penilai.',8)
for y in [165,148,131,114,97,80,63]: line(y)
footer(2)
c.save()
print(OUT)
