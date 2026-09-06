from pdf_sanitizer.tables import extract_tables


class FakeTable:
    def __init__(self, bbox, rows=4, cols=3, markdown=None):
        self.bbox = bbox
        self.row_count = rows
        self.col_count = cols
        self._markdown = markdown or "| A | B |\n| --- | --- |\n| 1 | 2 |"

    def to_markdown(self, **_kwargs):
        return self._markdown


class FakeFinder:
    def __init__(self, tables):
        self.tables = tables


class FakePage:
    rect = (0, 0, 600, 800)

    def __init__(self, *, ruled=False):
        self.ruled = ruled
        self.calls = []

    def find_tables(self, **kwargs):
        self.calls.append(kwargs)
        strategy = kwargs.get("strategy")
        if self.ruled and strategy == "lines_strict":
            return FakeFinder([FakeTable((60, 100, 540, 320))])
        if not self.ruled and strategy == "text":
            return FakeFinder(
                [
                    FakeTable(
                        (20, 40, 580, 760),
                        rows=35,
                        cols=6,
                        markdown="|This ordina|ry prose|\n|---|---|\n|keeps gett|ing split|",
                    )
                ]
            )
        return FakeFinder([])


def test_ruled_table_is_preserved_without_layout_table_model():
    page = FakePage(ruled=True)
    tables = extract_tables(page)

    assert len(tables) == 1
    assert "| A | B |" in tables[0][1]
    assert page.calls[0] == {"strategy": "lines_strict", "use_layout": False}


def test_pagewide_whitespace_grid_is_rejected():
    page = FakePage(ruled=False)
    tables = extract_tables(page)

    assert tables == []
    assert page.calls
    assert all(call.get("use_layout") is False for call in page.calls)
