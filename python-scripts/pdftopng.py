import os
from pdf2image import convert_from_path

# ==============================
# 📂 设置 PDF 存放文件夹和输出文件夹
# 📂 Set PDF storage folder and output folder
# 📂 PDFを保存するフォルダと出力フォルダを設定
# ==============================

pdf_folder = "/path/to/your/pdf_folder"       # 👉 这里替换成你的 PDF 文件夹路径
output_folder = "/path/to/your/output_folder" # 👉 这里替换成你的输出图片文件夹路径

# ==============================
# ✅ 确保输出文件夹存在
# ✅ Ensure the output folder exists
# ✅ 出力フォルダが存在することを確認する
# ==============================
if not os.path.exists(output_folder):
    os.makedirs(output_folder)

# ==============================
# 🔍 遍历文件夹中的所有 PDF 文件
# 🔍 Traverse all PDF files in the folder
# 🔍 フォルダ内のすべてのPDFファイルを走査する
# ==============================
for filename in os.listdir(pdf_folder):
    if filename.lower().endswith(".pdf"):  # 只处理 PDF 文件 / Only process PDF files / PDFファイルのみ処理
        pdf_path = os.path.join(pdf_folder, filename)
        pdf_name = os.path.splitext(filename)[0]  # 获取文件名（不含扩展名）

        # ==============================
        # 📁 为当前 PDF 创建一个子文件夹
        # 📁 Create a subfolder for the current PDF
        # 📁 現在のPDF用にサブフォルダを作成
        # ==============================
        pdf_output_folder = os.path.join(output_folder, pdf_name)
        if not os.path.exists(pdf_output_folder):
            os.makedirs(pdf_output_folder)

        print(f"正在转换 / Converting / 変換中: {pdf_path}")

        # ==============================
        # 🖼️ 进行 PDF 转图片转换（DPI 可调整）
        # 🖼️ Convert PDF to images (DPI adjustable)
        # 🖼️ PDFを画像に変換（DPI調整可能）
        # ==============================
        images = convert_from_path(pdf_path, dpi=300)

        # ==============================
        # 💾 保存每一页为图片
        # 💾 Save each page as an image
        # 💾 各ページを画像として保存
        # ==============================
        for i, img in enumerate(images):
            img.save(os.path.join(pdf_output_folder, f"{pdf_name}_page_{i+1}.jpg"), "JPEG")

        print(f"✅ {pdf_name} 转换完成，共 {len(images)} 页 / Conversion completed / 完了: {len(images)} pages")

print("🎉 所有PDF转换完成！ / All PDF conversions completed! / 全てのPDF変換が完了しました！")
