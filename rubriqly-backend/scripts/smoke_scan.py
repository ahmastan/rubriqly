"""Read rubric photos with the REAL scanner, to check accuracy before or after a change.

⚠️ With --yes this costs money (about a cent per scan). Without --yes nothing is sent to the model:
it checks the photos and asks the gateway (free) whether SCAN_MODEL exists.
Uses AI_GATEWAY_API_KEY from rubriqly-backend/.env; SCAN_MODE in .env is not changed.
Doesn't touch the database. Photos should be under 2.5 MB each: shrink big ones first with
`sips -Z 2000 photo.jpg --out small.jpg` (macOS).

    uv run python scripts/smoke_scan.py photo.jpg                   # dry run, free
    uv run python scripts/smoke_scan.py --yes page1.png page2.png   # one scan of a 2-page rubric
    uv run python scripts/smoke_scan.py --yes --each a.webp b.webp  # one scan per photo
"""

import argparse
import asyncio
import json
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx

from rubriqly.config import Settings
from rubriqly.scan import GatewayScanClient, ScanError, ScanImage, ScanResult, sniff_media_type
from rubriqly.scan.client import build_payload

MAX_BYTES = 2_500_000
MAX_IMAGES = 3
METADATA_KEYS = ("id", "model", "usage", "providerMetadata", "provider_metadata")


def load(path: Path) -> ScanImage:
    data = path.read_bytes()
    media_type = sniff_media_type(data)
    if media_type is None:
        sys.exit(f"{path.name}: not a JPG, PNG or WebP image")
    if len(data) > MAX_BYTES:
        sys.exit(f"{path.name} is {len(data):,} bytes. Shrink it: sips -Z 2000 {path} --out x.jpg")
    return ScanImage(media_type=media_type, data=data)


def show(result: ScanResult, raw_meta: dict[str, Any]) -> None:
    rubric = result.rubric
    print(f"Title:  {rubric.title}")
    print(f"Levels (lowest first): {' | '.join(rubric.levels)}")
    for criterion in rubric.criteria:
        print(f"\n■ {criterion.name}")
        for level, descriptor in zip(rubric.levels, criterion.descriptors, strict=True):
            print(f"    {level:<14} {descriptor or '(empty)'}")
        print(f"    suggested question: {criterion.suggested_question}")
        for level, tip in zip(rubric.levels, criterion.suggested_tips, strict=True):
            print(f"    suggested tip ({level}): {tip}")
    if rubric.checklist:
        print("\nChecklist:")
        for item in rubric.checklist:
            print(f"  • {item.name}  →  {item.suggested_question}")
    if rubric.word_count:
        print(f"\nWord count: {rubric.word_count.min} to {rubric.word_count.max}")
    if rubric.notes:
        print(f"\nNotes from the model: {rubric.notes}")
    print(
        f"\nModel {result.model}: {result.input_tokens} input + {result.output_tokens} output "
        f"tokens, list price ${result.market_cost_usd:.6f}, charged ${result.cost_usd:.6f}"
    )
    print(f"Response metadata (to confirm where cost is reported): {json.dumps(raw_meta)}")


def recorder(meta: dict[str, Any]) -> Any:
    """An httpx hook that keeps each response's usage and metadata (not its content)."""

    async def keep(response: httpx.Response) -> None:
        await response.aread()
        meta.clear()
        try:
            body = response.json()
            meta.update({k: body[k] for k in METADATA_KEYS if k in body})
            meta["finish_reason"] = body["choices"][0].get("finish_reason")
        except (ValueError, KeyError, IndexError, TypeError):
            meta["status"] = response.status_code

    return keep


async def check_model(settings: Settings) -> None:
    key = settings.ai_gateway_api_key.get_secret_value()
    if not key:
        print("(AI_GATEWAY_API_KEY is empty, so the model id wasn't checked)")
        return
    url = f"{settings.jev_base_url.rstrip('/')}/models/{settings.scan_model}"
    async with httpx.AsyncClient(timeout=15) as http:
        response = await http.get(url, headers={"Authorization": f"Bearer {key}"})
    if response.is_success:
        print(f"Model {settings.scan_model} exists: {json.dumps(response.json())[:400]}")
    else:
        print(f"⚠ The gateway doesn't know {settings.scan_model} (HTTP {response.status_code}).")


async def real_run(settings: Settings, groups: list[list[tuple[Path, ScanImage]]]) -> None:
    meta: dict[str, Any] = {}
    http = httpx.AsyncClient(
        timeout=settings.scan_timeout_seconds, event_hooks={"response": [recorder(meta)]}
    )
    client = GatewayScanClient(settings, http=http)
    total = Decimal(0)
    try:
        for group in groups:
            names = ", ".join(path.name for path, _ in group)
            print(f"\n{'=' * 78}\nScanning {names}\n{'=' * 78}")
            try:
                result = await client.scan([image for _, image in group])
            except ScanError as error:
                print(f"✗ {error.kind}: {error.message}\n  detail: {error}")
                print(f"  response metadata: {json.dumps(meta)}")
                continue
            show(result, meta)
            total += result.market_cost_usd
    finally:
        await client.aclose()
    print(f"\nTotal list price: ${total:.6f}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("photos", nargs="+", type=Path)
    parser.add_argument("--yes", action="store_true", help="really scan (costs money)")
    parser.add_argument("--each", action="store_true", help="scan each photo on its own")
    args = parser.parse_args()

    loaded = [(path, load(path)) for path in args.photos]
    groups = [[item] for item in loaded] if args.each else [loaded]
    if any(len(group) > MAX_IMAGES for group in groups):
        sys.exit(f"A scan can have up to {MAX_IMAGES} photos. Use --each to scan them one by one.")

    settings = Settings()
    if not args.yes:
        print("DRY RUN: nothing sent to the model, nothing spent. Add --yes to scan for real.\n")
        for group in groups:
            payload = build_payload(settings, [image for _, image in group])
            size = len(json.dumps(payload))
            names = ", ".join(f"{p.name} ({i.media_type}, {len(i.data):,} bytes)" for p, i in group)
            print(f"Scan of {names}: request {size:,} bytes")
        print(f"\n{len(groups)} scan(s) with {settings.scan_model}.")
        asyncio.run(check_model(settings))
        return
    if not settings.ai_gateway_api_key.get_secret_value():
        sys.exit("AI_GATEWAY_API_KEY is empty in rubriqly-backend/.env")
    settings = settings.model_copy(update={"scan_mode": "live"})
    asyncio.run(real_run(settings, groups))


if __name__ == "__main__":
    main()
