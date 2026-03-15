import os
from pathlib import Path

import nbformat
from nbclient import NotebookClient


def main() -> None:
    notebook_path = Path(os.getenv("NOTEBOOK_PATH", "EIL_jupyter_ver3.ipynb"))
    output_path = Path(os.getenv("OUTPUT_NOTEBOOK_PATH", "artifacts/EIL_jupyter_ver3.executed.ipynb"))
    timeout = int(os.getenv("NOTEBOOK_CELL_TIMEOUT", "900"))

    if not notebook_path.exists():
        raise FileNotFoundError(f"Notebook not found: {notebook_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with notebook_path.open("r", encoding="utf-8") as f:
        nb = nbformat.read(f, as_version=4)

    # Execute notebook in-process so this can run as a Cloud Run Job batch task.
    client = NotebookClient(nb, timeout=timeout, kernel_name="python3")
    executed_nb = client.execute()

    with output_path.open("w", encoding="utf-8") as f:
        nbformat.write(executed_nb, f)

    print(f"Notebook executed successfully: {notebook_path}")
    print(f"Executed notebook saved to: {output_path}")


if __name__ == "__main__":
    main()
