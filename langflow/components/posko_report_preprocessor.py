"""Langflow UI for shared report preprocessing and source verification."""
from lfx.custom.custom_component.component import Component
from lfx.io import DropdownInput, MultilineInput, Output
from lfx.schema.message import Message
from sigap_preprocess import prepare_source, preprocess, parse_reports, redact_pii

class PoskoReportPreprocessor(Component):
    display_name = "Posko Report Preprocessor"
    description = (
        "Memecah ekspor chat WhatsApp atau teks tempelan menjadi laporan bernomor "
        "dan menyamarkan NIK, nomor HP, email, nomor rekening, serta nama sebelum masuk LLM."
    )
    icon = "shield-check"
    name = "PoskoReportPreprocessor"

    inputs = [
        MultilineInput(
            name="raw_text",
            display_name="Teks Laporan",
            info="Isi file ekspor chat WhatsApp (.txt) atau pesan-pesan yang ditempel.",
            required=True,
        ),
        DropdownInput(
            name="date_order",
            display_name="Urutan Tanggal",
            options=["DMY", "MDY"],
            value="DMY",
            info="DMY untuk HP berbahasa Indonesia (27/09/26), MDY untuk bahasa Inggris AS (9/27/26).",
            advanced=True,
        ),
        MultilineInput(
            name="extraction_template",
            display_name="Template Instruksi Ekstraksi",
            value="",
            info="Opsional: template dengan satu variabel {reports}. Kosong mengembalikan laporan bersih.",
            advanced=True,
        ),
    ]

    outputs = [
        Output(display_name="Laporan Bersih", name="clean_reports", method="build_clean_reports"),
    ]

    def build_clean_reports(self) -> Message:
        text, self.status = prepare_source(self.raw_text or "", self.date_order or "DMY")
        template = getattr(self, 'extraction_template', '') or ''
        if template:
            from string import Formatter
            fields = [field for _, field, spec, conversion in Formatter().parse(template)
                      if field is not None]
            if fields != ['reports']:
                raise ValueError('Template ekstraksi harus memuat tepat satu variabel reports.')
            text = template.format(reports=text)
        return Message(text=text)
