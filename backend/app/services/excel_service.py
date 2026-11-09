import io
import logging

import openpyxl
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.drawing.image import Image as OpenpyxlImage
from openpyxl.styles import Alignment, Font, PatternFill
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)


def create_excel_with_images(data_list):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Billing Data"
    sheet.append(["Date", "Club Name", "Poster Image"])
    sheet.freeze_panes = "A2"

    for cell in sheet[1]:
        cell.font = Font(bold=True, size=12, color="FFFFFF")
        cell.fill = PatternFill(start_color="4F81BD", end_color="4F81BD", fill_type="solid")
        cell.alignment = Alignment(horizontal="center", vertical="center")

    sheet.column_dimensions["A"].width = 15
    sheet.column_dimensions["B"].width = 30
    sheet.column_dimensions["C"].width = 32

    for row, item in enumerate(data_list, start=2):
        sheet.row_dimensions[row].height = 150
        for column, field in ((1, "date"), (2, "club_name")):
            value = ILLEGAL_CHARACTERS_RE.sub("", item.get(field, ""))
            cell = sheet.cell(row=row, column=column, value=value)
            cell.data_type = "s"
            cell.alignment = Alignment(vertical="center", wrap_text=True)

        image_bytes = item.get("image_bytes")
        if image_bytes:
            try:
                with Image.open(io.BytesIO(image_bytes)) as source:
                    image = ImageOps.exif_transpose(source)
                    image.thumbnail((210, 190), Image.Resampling.LANCZOS)
                    stream = io.BytesIO()
                    image.save(stream, format="PNG")
                stream.seek(0)
                sheet.add_image(OpenpyxlImage(stream), f"C{row}")
            except (OSError, ValueError, Image.DecompressionBombError):
                logger.warning("Unable to embed poster in worksheet row %s", row)
                sheet.cell(row=row, column=3, value="[Image Error]")

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()
