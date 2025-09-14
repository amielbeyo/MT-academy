import os
from datetime import datetime, timezone
from pathlib import Path
import subprocess

BASE_URL = "https://mocktrialacademy.com"


def lastmod_from_git(path: Path) -> datetime:
    """Return the commit date of the last change to *path*."""
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%cI", str(path)],
            capture_output=True,
            text=True,
            check=True,
        )
        mtime = datetime.fromisoformat(result.stdout.strip())
        now = datetime.now(timezone.utc)
        if mtime > now:
            mtime = now
        return mtime
    except Exception:
        return datetime.now(timezone.utc)


def build_urls(root: Path):
    urls = []
    for path in root.rglob("*.html"):
        if path.name.startswith("_"):
            continue
        loc = BASE_URL + "/" + path.relative_to(root).as_posix()
        if path.name == "index.html":
            loc = BASE_URL + "/"
            priority = "1.0"
            changefreq = "weekly"
        else:
            priority = "0.8"
            changefreq = "monthly"
        mtime = lastmod_from_git(path)
        urls.append((loc, mtime, priority, changefreq))
    urls.sort(key=lambda x: x[0])
    return urls


def write_sitemap(urls, outfile: Path):
    with outfile.open("w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for loc, mtime, priority, changefreq in urls:
            f.write("  <url>\n")
            f.write(f"    <loc>{loc}</loc>\n")
            f.write(f"    <lastmod>{mtime.date().isoformat()}</lastmod>\n")
            f.write(f"    <changefreq>{changefreq}</changefreq>\n")
            f.write(f"    <priority>{priority}</priority>\n")
            f.write("  </url>\n")
        f.write('</urlset>\n')


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    urls = build_urls(root)
    write_sitemap(urls, root / "sitemap.xml")
