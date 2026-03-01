import os
import cv2
import numpy as np

def crop_to_alpha(img: np.ndarray, alpha_threshold: int = 0) -> np.ndarray:
    """
    Crops image to the bounding box of pixels with alpha > alpha_threshold.
    Works only if img is BGRA (4 channels). If fully transparent, returns original.
    """
    if img.ndim != 3 or img.shape[2] != 4:
        return img  # no alpha -> nothing to crop by alpha

    alpha = img[:, :, 3]
    mask = alpha > alpha_threshold

    if not np.any(mask):
        # image is fully transparent; choose behavior:
        # return img
        raise ValueError("Image appears fully transparent (no alpha > threshold).")

    ys, xs = np.where(mask)
    y_min, y_max = ys.min(), ys.max()
    x_min, x_max = xs.min(), xs.max()

    # +1 because slicing is exclusive at the end
    return img[y_min:y_max + 1, x_min:x_max + 1]


def make_square_with_padding(img: np.ndarray, bg=(0, 0, 0, 0)) -> np.ndarray:
    h, w = img.shape[:2]
    size = max(h, w)

    if img.ndim == 3 and img.shape[2] == 4:
        canvas = np.zeros((size, size, 4), dtype=np.uint8)
        canvas[:] = bg
    else:
        canvas = np.zeros((size, size, 3), dtype=np.uint8)
        canvas[:] = bg[:3]

    y0 = (size - h) // 2
    x0 = (size - w) // 2
    canvas[y0:y0 + h, x0:x0 + w] = img
    return canvas


def resize_icons(
    input_path: str,
    out_dir: str = "icons",
    sizes=(16, 48, 128),
    pad_bg=None,
    alpha_threshold: int = 0,
    do_alpha_crop: bool = True,
):
    os.makedirs(out_dir, exist_ok=True)

    img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Could not read image: {input_path}")

    # If grayscale -> BGR
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

    has_alpha = (img.ndim == 3 and img.shape[2] == 4)

    # Optional: crop by alpha bounding box
    if do_alpha_crop and has_alpha:
        img = crop_to_alpha(img, alpha_threshold=alpha_threshold)

    # Decide padding background
    if pad_bg is None:
        pad_bg = (0, 0, 0, 0) if has_alpha else (255, 255, 255)

    # If image is 3-channel but bg is 4-tuple, trim
    if img.ndim == 3 and img.shape[2] == 3 and len(pad_bg) == 4:
        pad_bg = pad_bg[:3]

    square = make_square_with_padding(img, bg=pad_bg)

    for s in sizes:
        resized = cv2.resize(square, (s, s), interpolation=cv2.INTER_AREA)
        out_path = os.path.join(out_dir, f"icon{s}.png")

        ok = cv2.imwrite(out_path, resized)
        if not ok:
            raise RuntimeError(f"Failed to write: {out_path}")

        print(f"Saved {out_path} ({s}x{s})")


if __name__ == "__main__":
    resize_icons(
        "icons/IconOrganizer.png",
        out_dir="icons",
        sizes=(16, 48, 128),
        alpha_threshold=0,   # set to e.g. 10 if you want to ignore faint semi-transparent edges
        do_alpha_crop=True
    )