"""Extract Sahwa PSB templates from their original cached layer pixels.

Usage (source files intentionally are not checked into Git):
    python scripts/prepare-psb-assets.py /path/to/original-attachments

Requirements: psd-tools[composite] 1.24, Pillow, numpy, PyMuPDF.
No fonts are reconstructed or redistributed by this script. The title, subtitle,
speaker, and information overlays keep the original cached raster artwork. The
embedded Illustrator PDFs are inspected only for text/font/layout metadata.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path

import fitz
import numpy as np
from PIL import Image
from psd_tools import PSDImage


ROOT = Path(__file__).resolve().parents[1]
CANVAS = (1080, 1300)
VIEWPORT = (0, 0, *CANVAS)
TITLE = "العنوان\nالرئيسي"
SUBTITLE = "كتابة جملة ثانوية فرعية لشرح العنوان"


def source_path(source_dir: Path, number: int) -> Path:
    digit = "٢" if number == 2 else "٣"
    for name in (f"صحوة تيمبليت {digit}(1).psb", f"صحوة تيمبليت {digit}.psb"):
        path = source_dir / name
        if path.exists():
            return path
    raise FileNotFoundError(f"Missing original Sahwa template {number} in {source_dir}")


def canvas() -> Image.Image:
    return Image.new("RGBA", CANVAS, (0, 0, 0, 0))


def stack(*images: Image.Image) -> Image.Image:
    result = canvas()
    for image in images:
        result = Image.alpha_composite(result, image.convert("RGBA"))
    return result


def split_title(image: Image.Image, split_y: int) -> tuple[Image.Image, Image.Image]:
    """Separate the cached title and subtitle at their transparent vertical gap."""
    alpha = np.asarray(image.getchannel("A"))
    assert not alpha[split_y - 2 : split_y + 2].any(), "Text split would cut source pixels"
    title, subtitle = canvas(), canvas()
    title.paste(image.crop((0, 0, CANVAS[0], split_y)), (0, 0))
    subtitle.paste(image.crop((0, split_y, CANVAS[0], CANVAS[1])), (0, split_y))
    reconstructed = np.asarray(Image.alpha_composite(title, subtitle))
    original = np.asarray(image)
    assert np.array_equal(reconstructed[:, :, 3], original[:, :, 3])
    assert np.array_equal(reconstructed[alpha > 0], original[alpha > 0])
    return title, subtitle


def pdf_info(layer) -> dict:
    data = layer.smart_object.data
    doc = fitz.open(stream=data, filetype="pdf")
    page = doc[0]
    spans = [span for block in page.get_text("dict")["blocks"]
             for line in block.get("lines", []) for span in line["spans"]]
    return {
        "pageSize": [page.rect.width, page.rect.height],
        "rawExtractedText": page.get_text(),
        "fonts": sorted({span["font"] for span in spans}),
        "spans": [{key: span[key] for key in ("font", "size", "text", "origin", "bbox", "color")}
                  for span in spans],
        "transformBox": list(layer.smart_object.transform_box),
    }


def title_layout(pdf: dict, bounds, subtitle_bounds, centered=False) -> tuple[dict, dict]:
    box = pdf["transformBox"]
    scale_y = (box[5] - box[1]) / pdf["pageSize"][1]
    title_spans = [span for span in pdf["spans"] if "Asal" in span["font"]]
    subtitle_span = next(span for span in pdf["spans"] if "ExtraL" in span["font"])
    baselines = sorted({round(box[1] + span["origin"][1] * scale_y, 3)
                        for span in title_spans})
    title_size = title_spans[0]["size"] * scale_y
    subtitle_size = subtitle_span["size"] * scale_y
    title = {
        "right": bounds[2], "width": bounds[2] - bounds[0],
        "x": bounds[0], "y": bounds[1], "height": bounds[3] - bounds[1],
        "max": round(title_size, 3), "min": 58, "baselines": baselines,
        "lineHeight": round((baselines[1] - baselines[0]) / title_size, 6),
        "maxLines": 2, "align": "center" if centered else "right", "bounds": list(bounds),
    }
    subtitle = {
        "right": subtitle_bounds[2], "width": subtitle_bounds[2] - subtitle_bounds[0],
        "max": round(subtitle_size, 3), "min": 20,
        "baseline": round(box[1] + subtitle_span["origin"][1] * scale_y, 3),
        "maxLines": 1, "align": "center" if centered else "right",
        "bounds": list(subtitle_bounds),
    }
    return title, subtitle


def body_layout(pdf: dict, bounds, width: int, minimum=23) -> dict:
    box, span = pdf["transformBox"], pdf["spans"][0]
    scale_y = (box[5] - box[1]) / pdf["pageSize"][1]
    return {
        "right": bounds[2], "width": width,
        "max": round(span["size"] * scale_y, 3), "min": minimum,
        "baseline": round(box[1] + span["origin"][1] * scale_y, 3),
        "align": "right", "maxLines": 1, "bounds": list(bounds),
    }


def extract(source: Path, number: int, output_root: Path, inspection: Path) -> dict:
    psd = PSDImage.open(source)
    assert psd.size == CANVAS, f"Unexpected artboard size: {psd.size}"
    layers = list(psd.descendants())
    output = output_root / f"psb{number}"
    output.mkdir(parents=True, exist_ok=True)
    inspection.mkdir(parents=True, exist_ok=True)
    assets: dict[str, str] = {}

    def composite(indices) -> Image.Image:
        selected = {id(layers[index]) for index in indices}
        # Selected smart objects use their cached, placed PSD pixels, not a
        # re-render of the embedded AI/PDF. Clipped layers are selected explicitly.
        result = psd.composite(
            viewport=VIEWPORT, force=True, alpha=0,
            layer_filter=lambda layer: layer.is_visible() and id(layer) in selected,
        )
        assert result is not None
        return result.convert("RGBA")

    def save(name: str, image: Image.Image, filename: str | None = None) -> Image.Image:
        filename = filename or f"{name}.png"
        image.save(output / filename, optimize=True)
        assets[name] = f"assets/psb{number}/{filename}"
        return image

    preview = psd.topil().convert("RGBA")
    preview.save(inspection / f"psb{number}-source-preview.png", optimize=True)
    thumbnail = preview.copy()
    thumbnail.thumbnail((180, 217), Image.Resampling.LANCZOS)
    save("thumbnail", thumbnail)

    title_index = 11 if number == 2 else 9
    title_pdf = pdf_info(layers[title_index])
    text = composite([title_index])
    title, subtitle = split_title(text, 577 if number == 2 else 608)
    save("originalTitle", title)
    save("originalSubtitle", subtitle)
    title_geometry, subtitle_geometry = title_layout(
        title_pdf, title.getchannel("A").getbbox(), subtitle.getchannel("A").getbbox(), number == 3,
    )

    defaults = {"title": TITLE, "subtitle": SUBTITLE, "speakerName": ""}
    for row in range(1, 4):
        defaults[f"info{row}Label"] = ""
        defaults[f"info{row}Value"] = "نقاط المعلومات" if number == 2 else ""
    fields = {
        "subtitle": True, "speakerName": number == 2, "informationCount": 3 if number == 2 else 0,
        "labels": False, "image": True,
        "imageHint": "يفضل صورة PNG مفرغة للشخص؛ تتحكم في حجمها وموضعها داخل الإطار."
        if number == 2 else "صورة طولية أو مربعة؛ يحتفظ القالب بالتدرج الأصلي فوق الصورة.",
    }
    layout = {"title": title_geometry, "subtitle": subtitle_geometry}
    embedded = {"titleAndSubtitle": title_pdf}

    if number == 2:
        # Circle is deliberately excluded from fixed artwork: the original photo
        # is clipped to this partially transparent/feathered base. Drawing the
        # circle twice would change its edge/shadow. Use photoBackdrop only for
        # replacement photos and defaultPhoto (combined group) for the original.
        background = save("background", composite([0, 1, 2, 3, 4, 5, 10]))
        photo_backdrop = save("photoBackdrop", composite([7]))
        default_photo = save("defaultPhoto", composite([7, 8, 9]))

        # General replacement geometry, NOT the old lecturer's cutout silhouette.
        # Open upper area supports new transparent portraits above the circle;
        # transition joins the original feathered ellipse through its lower half.
        mask = np.asarray(photo_backdrop.getchannel("A")).copy()
        open_upper = np.zeros_like(mask)
        open_upper[490:694, 0:494] = 255
        for y in range(694, 806):
            open_upper[y, 0:494] = round(255 * (806 - y) / 112)
        mask = np.maximum(mask, open_upper)
        mask[:490] = 0
        mask[1064:] = 0
        mask[:, 494:] = 0
        photo_mask = canvas()
        photo_mask.paste((255, 255, 255, 255), (0, 0, *CANVAS))
        photo_mask.putalpha(Image.fromarray(mask))
        save("photoMask", photo_mask)
        layout["photo"] = {
            "x": 0, "y": 490, "width": 494, "height": 574,
            "shape": "mask", "fit": "contain", "grayscale": True,
            "maskBounds": [0, 490, 494, 1064], "maskCanvas": list(CANVAS),
            "sourcePhotoBounds": [-167, 392, 822, 1052],
            "sourceCircleBounds": [-9, 548, 494, 1064],
        }

        defaults["speakerName"] = "اسم الأستاذ"
        speaker = save("originalSpeakerName", composite([12]))
        speaker_pdf = pdf_info(layers[12])
        embedded["speakerName"] = speaker_pdf
        layout["speakerName"] = body_layout(speaker_pdf, layers[12].bbox, 449)

        marker_images = [composite([index]) for index in (13, 14, 15)]
        positions = []
        for row, (marker_image, index) in enumerate(zip(marker_images, (13, 14, 15)), start=1):
            box = layers[index].bbox
            save("marker" if row == 1 else f"marker{row}", marker_image.crop(box))
            positions.append({"x": box[0], "y": box[1], "width": box[2] - box[0], "height": box[3] - box[1]})
        layout["markers"] = positions

        information_images = []
        information_rows = []
        for row, index in enumerate((18, 17, 16), start=1):
            image = save(f"originalInformation{row}", composite([index]))
            information_images.append(image)
            pdf = pdf_info(layers[index])
            embedded[f"information{row}"] = pdf
            information_rows.append(body_layout(pdf, layers[index].bbox, 415))
        layout["information"] = {
            "right": 935, "width": 415, "max": information_rows[0]["max"], "min": 23,
            "baselines": [row["baseline"] for row in information_rows],
            "maxLines": 1, "align": "right", "rows": information_rows,
        }
        reconstructed = stack(background, default_photo, title, subtitle, speaker, *marker_images, *information_images)
        name = "محاضرة مع صورة المحاضر"
        description = "صورة شخصية فوق إطار دائري، عنوان وجملة ثانوية، اسم المحاضر وثلاث خانات معلومات."
    else:
        background = save("background", composite([0]))
        default_photo = save("defaultPhoto", composite([7]))
        foreground = save("foreground", composite([8, 10]))
        layout["photo"] = {
            "x": 0, "y": 181, "width": 1080, "height": 1119,
            "shape": "rect", "fit": "cover", "grayscale": False,
            "sourcePhotoBounds": [-4, 181, 1086, 1800],
            "foregroundBounds": [0, 0, 1080, 1142],
        }
        layout["information"] = {"right": 0, "width": 0, "max": 0, "min": 0, "baselines": []}
        reconstructed = stack(background, default_photo, foreground, title, subtitle)
        name = "عنوان فوق صورة"
        description = "عنوان وجملة ثانوية في المنتصف مع صورة كبيرة أسفل التدرج الأصلي."

    # Rendering QA is against Photoshop's saved merged preview, including alpha.
    a = np.asarray(preview).astype(np.int16)
    b = np.asarray(reconstructed).astype(np.int16)
    difference = np.abs(a - b)
    fidelity = {
        "rgbMeanAbsoluteDifference": float(difference[:, :, :3].mean()),
        "rgbaMeanAbsoluteDifference": float(difference.mean()),
        "maxChannelDifference": int(difference.max()),
        "alphaMeanAbsoluteDifference": float(difference[:, :, 3].mean()),
        "fractionPixelsWithRgbDifferenceAbove4": float((difference[:, :, :3] > 4).any(axis=2).mean()),
        "sourceAlphaRange": [int(a[:, :, 3].min()), int(a[:, :, 3].max())],
        "method": "Original cached layers, masks, clipping group, opacity and Photoshop-saved pixels; no artwork/text redrawing.",
    }
    assert fidelity["rgbMeanAbsoluteDifference"] < 1, fidelity
    assert fidelity["fractionPixelsWithRgbDifferenceAbove4"] < 0.0001, fidelity
    reconstructed.save(inspection / f"psb{number}-reconstructed.png", optimize=True)

    # Keep diagnostics within tmp; originals remain as the user's attachments.
    layer_inventory = []
    for index, layer in enumerate(layers):
        entry = {"index": index, "name": layer.name, "kind": layer.kind,
                 "visible": layer.visible, "effectivelyVisible": layer.is_visible(),
                 "bbox": list(layer.bbox), "opacity": layer.opacity,
                 "blendMode": layer.blend_mode.value.decode("ascii"), "clipping": layer.clipping,
                 "hasMask": layer.has_mask(), "hasEffects": layer.has_effects()}
        if layer.has_mask():
            entry["mask"] = {"bbox": list(layer.mask.bbox), "background": layer.mask.background_color,
                             "disabled": layer.mask.disabled}
        layer_inventory.append(entry)
    (inspection / f"psb{number}-layers.json").write_text(
        json.dumps(layer_inventory, ensure_ascii=False, indent=2), encoding="utf-8",
    )

    metadata = {
        "id": f"psb{number}", "name": name, "description": description,
        "width": CANVAS[0], "height": CANVAS[1], "color": "#752026",
        "source": {"filename": source.name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                   "format": "Photoshop Large Document", "layerCount": len(layers)},
        "defaults": defaults, "fields": fields, "layout": layout, "assets": assets,
        "embeddedText": embedded,
        "fontNotes": {
            "title": "itfAsalArabic-Bold", "subtitle": "IBMPlexSansArabic-ExtraLight",
            "body": "IBMPlexSansArabic-Light" if number == 2 else None,
            "titleEditing": "Keep the original raster when unchanged. Edited titles require the user's original font or an explicitly temporary font.",
            "extraction": "The PDF's subset encoding omits/maps a few Arabic glyphs to controls; normalized defaults were verified against the saved visible artwork.",
        },
        "fidelity": fidelity,
    }
    (output / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"id": metadata["id"], "name": name, "metadata": str(output / "metadata.json"),
            "assets": len(assets), "fidelity": fidelity}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path, nargs="?", default=ROOT.parent / "upload")
    parser.add_argument("--output-root", type=Path, default=ROOT / "dist" / "assets")
    parser.add_argument("--inspection-dir", type=Path, default=ROOT / "tmp" / "psb-inspect")
    args = parser.parse_args()
    reports = [extract(source_path(args.source_dir, number), number, args.output_root, args.inspection_dir)
               for number in (2, 3)]
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
