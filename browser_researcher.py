#!/usr/bin/env python3
"""
browser_researcher.py v1.1 — uses direct JSON APIs instead of HTML scraping
wherever possible. Falls back to curl for docs.servicenow.com.
"""
import argparse, json, sys, re, subprocess, os, textwrap, time
from datetime import datetime
from pathlib import Path

try:
    import requests
    HAS_REQUESTS = True
except Exception:
    HAS_REQUESTS = False

BASE_DIR = Path(__file__).resolve().parent
OUT_JSON = BASE_DIR / "research_output_latest.json"

SEARCH_QUERIES = [
    ("zurich migration problems pain 2025","zurich"),
    ("australia new api breaking changes","australia"),
    ("ai agent studio setup tutorial","australia"),
    ("migration tools automation","both"),
    ("now assist skills configuration","australia"),
    ("workflow studio zurich","zurich"),
    ("cmdb migration best practice","both"),
    ("automated testing servicenow","both"),
    ("platform ai agents built-in","australia"),
    ("generative ai controller byok","australia"),
    ("instance scan duplicate cleanup","zurich"),
    ("scripted rest api new features","zurich"),
    ("flow designer deprecated","zurich"),
]

def log(msg: str):
    print(f"[RESEARCH] {msg}", file=sys.stderr)

def fetch_json(url: str, use_requests=True) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }
    if HAS_REQUESTS and use_requests:
        try:
            r = requests.get(url, headers=headers, timeout=20)
            if r.status_code == 200:
                return r.json() if "json" in r.headers.get("Content-Type","") else {"raw":r.text}
        except Exception as e:
            log(f"requests err: {e}")
    # fallback curl
    try:
        out = subprocess.run(["curl","-sL","-A",headers["User-Agent"],"--max-time","20",url], capture_output=True, text=True, timeout=25)
        if out.returncode == 0:
            try:
                return json.loads(out.stdout)
            except json.JSONDecodeError:
                return {"raw":out.stdout}
    except Exception as e:
        log(f"curl err: {e}")
    return {}

def fetch_text(url: str) -> str:
    headers = {"User-Agent":"Mozilla/5.0"}
    if HAS_REQUESTS:
        try:
            r = requests.get(url, headers=headers, timeout=20)
            return r.text if r.status_code == 200 else ""
        except Exception:
            pass
    try:
        out = subprocess.run(["curl","-sL","-A",headers["User-Agent"],"--max-time","20",url], capture_output=True, text=True, timeout=25)
        return out.stdout if out.returncode == 0 else ""
    except Exception:
        return ""

def search_reddit_json(query: str):
    url = f"https://www.reddit.com/search.json?q={query.replace(' ','+')}&sort=new&t=year&limit=25"
    data = fetch_json(url)
    posts = []
    for child in data.get("data",{}).get("children",[]):
        d = child.get("data",{})
        title = d.get("title","")
        selftext = d.get("selftext","")[:500]
        subreddit = d.get("subreddit","")
        posts.append({"source":"reddit","title":title,"snippet":selftext,"subreddit":subreddit,"query":query})
    return posts

def search_stackoverflow(query: str):
    # StackOverflow with servicenow tag
    url = f"https://api.stackexchange.com/2.3/search?order=desc&sort=activity&intitle={query.replace(' ','%20')}&tagged=servicenow&site=stackoverflow"
    data = fetch_json(url)
    items = data.get("items",[])
    return [{"source":"stackoverflow","title":i.get("title",""),"snippet":i.get("link",""),"score":i.get("score",0),"query":query} for i in items[:10]]

def search_servicenow_docs(release: str):
    """Try to fetch release notes via known docs patterns."""
    # Try two URL patterns
    patterns = [
        f"https://docs.servicenow.com/bundle/{release}-release-notes/page/release-notes/availability/rn-{release}-platform.html",
        f"https://docs.servicenow.com/bundle/{release}-release-notes/page/release-notes/availability/rn-{release}-family.html",
    ]
    results = []
    for url in patterns:
        html = fetch_text(url)
        if not html:
            continue
        # Extract all h2/h3 + following p
        sections = re.findall(r'<h[23][^>]*>(.*?)</h[23]>\s*<p>(.*?)\s*</p>', html, re.DOTALL|re.IGNORECASE)
        for h,t in sections:
            heading = re.sub(r'<[^>]+>','',h).strip()
            text = re.sub(r'<[^>]+>','',t).strip()
            if len(heading) < 4 or len(text) < 20:
                continue
            results.append({"source":"docs","title":heading,"snippet":text[:500],"query":release})
        if results:
            break
    return results

def search_google_custom(query: str):
    """Google site-search via duckduckgo html (ddg is friendlier to curl)."""
    q = f"site:servicenow.com {query}"
    url = f"https://html.duckduckgo.com/html/?q={q.replace(' ','+')}"
    html = fetch_text(url)
    results = []
    # duckduckgo html results
    links = re.findall(r'<a[^\u003e]*class="result__a"[^\u003e]*href="([^"]+)"[^\u003e]*>([^<]+)</a>', html, re.IGNORECASE)
    snippets = re.findall(r'<a[^\u003e]*class="result__snippet"[^\u003e]*>([^<]+)', html, re.IGNORECASE)
    for i, (href, title) in enumerate(links[:10]):
        results.append({"source":"ddg","title":title.strip(),"snippet":snippets[i].strip() if i < len(snippets) else "","query":query})
    return results

def score_candidate(title: str, snippet: str, source: str) -> float:
    score = 0.0
    pain = ["problem","issue","broken","pain","difficult","challenge","error","fail","slow","migrate","upgrade","deprecated","removed","limitation","workaround","manual","missing","not supported","migration","complex","painful","frustrating"]
    value = ["automate","automation","tool","plugin","app","solution","generator","scanner","optimizer","analyzer","framework","ai agent","studio"]
    t = (title+" "+snippet).lower()
    score += sum(2 for w in pain if w in t)
    score += sum(3 for w in value if w in t)
    if source in ("stackoverflow","docs"):
        score += 2
    if source == "reddit" and ("servicenow" in t or "migration" in t):
        score += 1.5
    if len(snippet) > 100:
        score += 1
    if "api" in t:
        score += 1.5
    return score

def run_research(releases=("zurich","australia")):
    candidates = []
    seen = set()
    for q, rel in SEARCH_QUERIES:
        if rel != "both" and rel not in releases:
            continue
        log(f"Query [{rel}]: {q}")
        try:
            reddit = search_reddit_json(q)
            for r in reddit:
                candidates.append(r)
        except Exception as e:
            log(f"reddit err: {e}")
        try:
            so = search_stackoverflow(q)
            for s in so:
                candidates.append(s)
        except Exception as e:
            log(f"so err: {e}")
        try:
            ddg = search_google_custom(q)
            for d in ddg:
                candidates.append(d)
        except Exception as e:
            log(f"ddg err: {e}")
        time.sleep(1.5)  # be polite

    for rel in releases:
        log(f"Fetching docs for {rel}")
        docs = search_servicenow_docs(rel)
        for d in docs:
            candidates.append(d)
        time.sleep(1.0)

    scored = []
    for c in candidates:
        key = re.sub(r'[^a-z0-9]','',c.get("title","").lower())[:50]
        if not key or key in seen:
            continue
        seen.add(key)
        s = score_candidate(c.get("title",""), c.get("snippet",""), c.get("source",""))
        if s >= 3:
            scored.append({"score":s,**c})

    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[:20]
    log(f"Found {len(scored)} scored candidates, top {len(top)} saved.")
    OUT_JSON.write_text(json.dumps(top, ensure_ascii=False, indent=2))
    return top

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", default="both", choices=["zurich","australia","both"])
    args = parser.parse_args()
    rels = ("zurich","australia") if args.release == "both" else (args.release,)
    top = run_research(rels)
    print(json.dumps(top, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
