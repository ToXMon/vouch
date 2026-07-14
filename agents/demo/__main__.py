"""Entry point: python -m agents.demo"""

import asyncio
import sys

from .ai_vs_ai import run_demo


def main() -> int:
    """Run the Vouch AI-vs-AI demo."""
    try:
        asyncio.run(run_demo())
    except KeyboardInterrupt:
        print("\n\nDemo interrupted.")
        return 130
    except Exception as exc:
        print(f"\n\nDemo error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
