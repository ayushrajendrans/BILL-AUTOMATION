import io
import logging
import re
import unicodedata
from calendar import monthrange

import openpyxl
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.drawing.image import Image as OpenpyxlImage
from openpyxl.styles import Alignment, Font, PatternFill
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)
THUMBNAIL_SIZE = (210, 190)
MONTHS = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)


def normalize_club(name):
    return " ".join(unicodedata.normalize("NFKC", name).split()).upper()


def normalize_month(value):
    name = value.strip().casefold()
    return next((month for month in MONTHS if name in (month.casefold(), month[:3].casefold())), "")


def month_from_date(date):
    match = re.fullmatch(r"(\d{1,2})[-\s]+([a-zA-Z]+)", date.strip())
    if not match:
        return ""
    day, name = match.groups()
    month = normalize_month(name)
    return month if month and 1 <= int(day) <= monthrange(2000, MONTHS.index(month) + 1)[1] else ""


def make_thumbnail(image_bytes):
    with Image.open(io.BytesIO(image_bytes)) as source:
        image = ImageOps.exif_transpose(source)
        image.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.convert("RGB").save(output, format="JPEG", quality=86, optimize=True)
    return output.getvalue()


def create_excel_with_images(data_list):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Billing Data"
    sheet.append(["Date", "Club Name", "Month", "Poster Image"])
    sheet.freeze_panes = "A2"

    for cell in sheet[1]:
        cell.font = Font(bold=True, size=12, color="FFFFFF")
        cell.fill = PatternFill(start_color="4F81BD", end_color="4F81BD", fill_type="solid")
        cell.alignment = Alignment(horizontal="center", vertical="center")

    sheet.column_dimensions["A"].width = 15
    sheet.column_dimensions["B"].width = 30
    sheet.column_dimensions["C"].width = 15
    sheet.column_dimensions["D"].width = 32

    for row, item in enumerate(data_list, start=2):
        sheet.row_dimensions[row].height = 150
        for column, text in ((1, item.get("date", "")), (2, item.get("club_name", "")),
                             (3, month_from_date(item.get("date", "")) or normalize_month(item.get("month", "")))):
            value = ILLEGAL_CHARACTERS_RE.sub("", text)
            cell = sheet.cell(row=row, column=column, value=value)
            cell.data_type = "s"
            cell.alignment = Alignment(vertical="center", wrap_text=True)

        if item.get("thumbnail") or item.get("image_bytes"):
            try:
                stream = io.BytesIO(item.get("thumbnail") or make_thumbnail(item["image_bytes"]))
                sheet.add_image(OpenpyxlImage(stream), f"D{row}")
            except (OSError, ValueError, Image.DecompressionBombError):
                logger.warning("Unable to embed poster in worksheet row %s", row)
                sheet.cell(row=row, column=4, value="[Image Error]")

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()
