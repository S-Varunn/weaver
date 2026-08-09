import os
from PIL import Image

raw_path = "/home/varun/.gemini/antigravity-ide/brain/fae974f7-a5c2-4b0d-b358-499d9097ca97/tray_icon_dual_neon_1786234550175.png"

if os.path.exists(raw_path):
    img = Image.open(raw_path).convert("RGBA")
    datas = img.getdata()

    new_data = []
    for item in datas:
        r, g, b, a = item
        brightness = (r + g + b) / 3.0
        # If black background, make transparent
        if brightness < 20:
            new_data.append((0, 0, 0, 0))
        else:
            # Preserve full color & glowing halo alpha scaling
            alpha = min(255, int(brightness * 1.8))
            new_data.append((r, g, b, alpha))

    img.putdata(new_data)
    
    # Save tray icons
    img.resize((128, 128), Image.Resampling.LANCZOS).save("src-tauri/icons/tray_128.png")
    img.resize((32, 32), Image.Resampling.LANCZOS).save("src-tauri/icons/32x32.png")
    img.resize((128, 128), Image.Resampling.LANCZOS).save("src-tauri/icons/128x128.png")
    img.resize((256, 256), Image.Resampling.LANCZOS).save("src-tauri/icons/128x128@2x.png")
    img.resize((512, 512), Image.Resampling.LANCZOS).save("src-tauri/icons/icon.png")
    img.save("src-tauri/icons/icon.ico", format="ICO", sizes=[(32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("Transparent dual neon tray icons created successfully!")
