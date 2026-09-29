"""Python entry point. Run from the HRMS project directory."""
import sys
from pathlib import Path

# Expose the sibling bridge package when this file is launched directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge.device_commands import main


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
