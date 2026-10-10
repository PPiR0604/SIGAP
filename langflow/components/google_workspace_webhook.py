"""Google Workspace Webhook — Langflow custom component.

Mengirim data ke Google Apps Script Web App milik tim (lihat integrations/google_apps_script/Code.gs):
- action "append_rows": menambah baris ke Google Sheets rekap posko (tidak pernah menimpa).
- action "create_doc": membuat Google Docs berisi draf buletin.

Tanpa LLM di jalur penulisan, sehingga yang ditulis persis sama dengan yang dikonfirmasi petugas.
Jika Webhook URL kosong atau gagal, komponen mengembalikan pesan fallback berisi data
agar petugas tetap bisa menyalinnya secara manual.

Cara pakai di Langflow: New Custom Component -> tempel seluruh isi file ini.
"""

from __future__ import annotations

import json
import re
import hashlib

import httpx

from lfx.custom.custom_component.component import Component
from lfx.io import DropdownInput, MessageTextInput, Output, SecretStrInput, StrInput
from lfx.schema.message import Message


def build_payload(action: str, text: str, title: str, shared_secret: str) -> dict:
    if action in ("append_rows", "upsert_rows"):
        fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
        candidate = fenced.group(1) if fenced else text
        start = candidate.find("{")
        if start == -1:
            raise ValueError("Data baris bukan JSON.")
        data, _ = json.JSONDecoder().raw_decode(candidate[start:])
        payload = {"action": action, "header": data.get("header", []), "rows": data.get("rows", [])}
    else:
        data = json.loads(text)
        content = data.get("content")
        if not isinstance(content, str) or not content:
            raise ValueError("Pratinjau buletin tidak valid.")
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        if data.get("confirmed_create_doc") is not True or data.get("approved_content_sha256") != digest or data.get("content_sha256") != digest:
            raise ValueError("Pembuatan Google Docs belum disetujui untuk isi pratinjau ini. Tampilkan draf dan content_sha256; setelah persetujuan khusus petugas, kirim confirmed_create_doc=true dan approved_content_sha256 yang sama. Perubahan isi membatalkan persetujuan.")
        payload = {"action": "create_doc", "title": title, "content": content,
                   "confirmed_create_doc": True, "approved_content_sha256": digest}
    payload["secret"] = shared_secret
    return payload


class GoogleWorkspaceWebhook(Component):
    display_name = "Google Workspace Webhook"
    description = "Menyimpan data baris ke Google Sheets (upsert/append) atau membuat Google Docs lewat Apps Script."
    icon = "sheet"
    name = "GoogleWorkspaceWebhook"

    inputs = [
        MessageTextInput(name="content", display_name="Isi", required=True,
                         info="JSON baris dari Officer Confirmation Gate, atau teks buletin."),
        DropdownInput(name="action", display_name="Aksi", options=["upsert_rows", "append_rows", "create_doc"], value="upsert_rows"),
        StrInput(name="doc_title", display_name="Judul Dokumen", value="DRAF Buletin Kebutuhan Pengungsi",
                 info="Dipakai untuk aksi create_doc.", advanced=True),
        SecretStrInput(name="webhook_url", display_name="Webhook URL (Apps Script)", required=False,
                       info="URL Web App dari Google Apps Script. Kosongkan untuk mode demo/offline."),
        SecretStrInput(name="shared_secret", display_name="Shared Secret", required=False,
                       info="Harus sama dengan SHARED_SECRET di Code.gs.", advanced=True),
    ]

    outputs = [
        Output(display_name="Hasil", name="result", method="send"),
    ]

    def send(self) -> Message:
        text = self.content or ""
        if not text.strip():
            return Message(text="Tidak ada data untuk dikirim.")
        try:
            payload = build_payload(self.action, text, self.doc_title or "DRAF Buletin", self.shared_secret or "")
        except (ValueError, json.JSONDecodeError) as exc:
            return Message(text=f"DITOLAK — tidak ada aksi eksternal: {exc}\n\nPratinjau (belum disimpan):\n{text}")

        if not (self.webhook_url or "").strip():
            self.status = "Mode demo (tanpa webhook)"
            return Message(text=self._fallback("Webhook URL belum diisi (mode demo).", payload))
        try:
            resp = httpx.post(self.webhook_url.strip(), json=payload, timeout=30, follow_redirects=True)
            resp.raise_for_status()
            result = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            self.status = "Gagal mengirim"
            return Message(text=self._fallback(f"Gagal menghubungi Google Apps Script: {exc}", payload))

        if not result.get("ok"):
            return Message(text=self._fallback(f"Apps Script menolak: {result.get('error')}", payload))
        self.status = "Terkirim"
        if payload["action"] in ("append_rows", "upsert_rows"):
            return Message(text=f"BERHASIL: {result.get('appended', 0)} baris ditambahkan ke sheet rekap. "
                                f"Buka: {result.get('url', '-')}")
        return Message(text=f"BERHASIL: draf buletin dibuat di Google Docs (status DRAF, belum dibagikan). "
                             f"Buka dan periksa: {result.get('url', '-')}\n\n{payload['content']}")

    @staticmethod
    def _fallback(reason: str, payload: dict) -> str:
        shown = {k: v for k, v in payload.items() if k != "secret"}
        return (f"TIDAK TERSIMPAN OTOMATIS — {reason}\n"
                "Data di bawah bisa disalin manual oleh petugas:\n\n"
                + (shown.get("content") or json.dumps(shown, ensure_ascii=False, indent=2)))
