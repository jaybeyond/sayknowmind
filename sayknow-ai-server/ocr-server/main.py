"""
Tesseract OCR Server - Fast CPU-based OCR for images and PDFs
Supports Korean, English, Chinese, Japanese
"""
import os
import io
import base64
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
import pytesseract

app = FastAPI(title="Tesseract OCR Server", version="4.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Check if Tesseract is available
tesseract_available = False
tesseract_version = None

class OCRRequest(BaseModel):
    image: str  # base64 encoded
    prompt: str = "OCR"  # ignored, kept for API compatibility
    format: str = "text"
    lang: str = "korean"  # korean, english, chinese, japanese


class PDFRequest(BaseModel):
    pdf: str  # base64 encoded PDF
    prompt: str = "OCR"
    max_pages: int = 10
    lang: str = "korean"


class OCRResponse(BaseModel):
    text: str
    confidence: Optional[float] = None
    pages: Optional[int] = None


def get_tesseract_lang(lang: str) -> str:
    """Convert language name to Tesseract language code"""
    lang_map = {
        "korean": "kor+eng",
        "english": "eng",
        "chinese": "chi_sim+eng",
        "japanese": "jpn+eng",
    }
    return lang_map.get(lang, "kor+eng")


@app.on_event("startup")
async def startup():
    global tesseract_available, tesseract_version
    try:
        tesseract_version = pytesseract.get_tesseract_version()
        tesseract_available = True
        print(f"✅ Tesseract OCR loaded successfully (version: {tesseract_version})", flush=True)
        
        # Check available languages
        langs = pytesseract.get_languages()
        print(f"📚 Available languages: {', '.join(langs)}", flush=True)
    except Exception as e:
        print(f"❌ Failed to load Tesseract: {e}", flush=True)
        tesseract_available = False


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_loaded": tesseract_available,
        "model_loading": False,
        "model_error": None if tesseract_available else "Tesseract not available",
        "model": f"Tesseract {tesseract_version}" if tesseract_version else "Tesseract"
    }


@app.post("/extract", response_model=OCRResponse)
async def extract_text(request: OCRRequest):
    if not tesseract_available:
        raise HTTPException(status_code=503, detail="Tesseract OCR not available")
    
    try:
        # Decode base64 image
        image_data = base64.b64decode(request.image)
        image = Image.open(io.BytesIO(image_data))
        
        original_size = image.size
        print(f"📐 Original image size: {original_size[0]}x{original_size[1]}", flush=True)
        
        # Convert to RGB if needed (Tesseract works better with RGB)
        if image.mode != "RGB":
            print(f"🔄 Converting image from {image.mode} to RGB", flush=True)
            image = image.convert("RGB")
        
        # Get Tesseract language code
        lang_code = get_tesseract_lang(request.lang)
        print(f"🔍 Running Tesseract OCR (lang: {lang_code})...", flush=True)
        
        # Run OCR with Tesseract
        # Use --oem 3 (default) and --psm 3 (auto page segmentation)
        custom_config = r'--oem 3 --psm 3'
        
        # Get text and confidence data
        data = pytesseract.image_to_data(image, lang=lang_code, config=custom_config, output_type=pytesseract.Output.DICT)
        
        # Extract text and calculate average confidence
        texts = []
        confidences = []
        for i, conf in enumerate(data['conf']):
            if conf > 0:  # Only include detected text
                text = data['text'][i].strip()
                if text:
                    texts.append(text)
                    confidences.append(conf)
        
        full_text = ' '.join(texts)
        avg_confidence = sum(confidences) / len(confidences) / 100 if confidences else 0.0
        
        print(f"✅ OCR completed: {len(full_text)} chars, confidence: {avg_confidence:.2f}", flush=True)
        
        return OCRResponse(text=full_text, confidence=avg_confidence)
    
    except Exception as e:
        print(f"❌ OCR Error: {e}", flush=True)
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze")
async def analyze_image(request: OCRRequest):
    """Alias for /extract - kept for API compatibility"""
    return await extract_text(request)


@app.post("/extract-pdf", response_model=OCRResponse)
async def extract_pdf(request: PDFRequest):
    """Extract text from PDF file"""
    import fitz  # PyMuPDF
    
    if not tesseract_available:
        raise HTTPException(status_code=503, detail="Tesseract OCR not available")
    
    try:
        # Decode base64 PDF
        pdf_data = base64.b64decode(request.pdf)
        
        # Open PDF with PyMuPDF
        pdf_document = fitz.open(stream=pdf_data, filetype="pdf")
        total_pages = len(pdf_document)
        pages_to_process = min(total_pages, request.max_pages)
        
        print(f"📄 Processing PDF: {total_pages} pages, will process {pages_to_process}", flush=True)
        
        lang_code = get_tesseract_lang(request.lang)
        all_results = []
        all_confidences = []
        
        for page_num in range(pages_to_process):
            print(f"📖 Processing page {page_num + 1}/{pages_to_process}...", flush=True)
            
            # Get page and convert to image
            page = pdf_document[page_num]
            
            # Render page to image (2x zoom for better quality)
            mat = fitz.Matrix(2, 2)
            pix = page.get_pixmap(matrix=mat)
            
            # Convert to PIL Image
            image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            
            # Run OCR
            custom_config = r'--oem 3 --psm 3'
            data = pytesseract.image_to_data(image, lang=lang_code, config=custom_config, output_type=pytesseract.Output.DICT)
            
            texts = []
            confidences = []
            for i, conf in enumerate(data['conf']):
                if conf > 0:
                    text = data['text'][i].strip()
                    if text:
                        texts.append(text)
                        confidences.append(conf)
            
            page_text = ' '.join(texts)
            if page_text:
                all_results.append(f"[Page {page_num + 1}]\n{page_text}")
                all_confidences.extend(confidences)
        
        pdf_document.close()
        
        # Combine all page results
        combined_text = "\n\n".join(all_results)
        avg_confidence = sum(all_confidences) / len(all_confidences) / 100 if all_confidences else 0.0
        
        print(f"✅ PDF OCR completed: {len(combined_text)} chars from {pages_to_process} pages", flush=True)
        
        return OCRResponse(text=combined_text, confidence=avg_confidence, pages=pages_to_process)
    
    except Exception as e:
        print(f"❌ PDF OCR Error: {e}", flush=True)
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"🚀 Starting Tesseract OCR Server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
