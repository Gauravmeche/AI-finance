"""Build a tiny valid PDF so document extraction can be tested offline."""

from __future__ import annotations


def build_pdf(text: str = "Hello Acme concall transcript", pages: int = 1) -> bytes:
    page_ids = [3 + i for i in range(pages)]
    content_ids = [3 + pages + i for i in range(pages)]
    font_id = 3 + 2 * pages

    objects: list[bytes] = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids["
        + b" ".join(f"{pid} 0 R".encode() for pid in page_ids)
        + b"]/Count "
        + str(pages).encode()
        + b">>",
    ]

    for index, (page_id, content_id) in enumerate(zip(page_ids, content_ids), start=1):
        objects.append(
            b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents "
            + f"{content_id} 0 R".encode()
            + b"/Resources<</Font<</F1 "
            + f"{font_id} 0 R".encode()
            + b">>>>>>"
        )

    for index in range(1, pages + 1):
        body = f"BT /F1 24 Tf 72 700 Td ({text} page {index}) Tj ET".encode()
        objects.append(
            b"<</Length " + str(len(body)).encode() + b">>stream\n" + body + b"\nendstream"
        )

    objects.append(b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>")

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj".encode() + body + b"endobj\n"

    xref_offset = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer<</Size {len(objects) + 1}/Root 1 0 R>>\n"
        f"startxref\n{xref_offset}\n%%EOF"
    ).encode()
    return bytes(out)
