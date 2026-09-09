from pdf_sanitizer.tables import extract_tables


class FakeTable:
    def __init__(self, bbox, rows, cols, markdown):
        self.bbox = bbox
        self.row_count = rows
        self.col_count = cols
        self.markdown = markdown

    def to_markdown(self, **_kwargs):
        return self.markdown


class Finder:
    def __init__(self, tables):
        self.tables = tables


class FakePage:
    rect = (0, 0, 600, 800)

    def __init__(self, table, prose):
        self.table = table
        self.prose = prose
        self.calls = []

    def find_tables(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs.get("strategy") == "lines_strict":
            return Finder([self.table])
        return Finder([])

    def get_text(self, kind, **_kwargs):
        assert kind == "text"
        return self.prose


def test_line_strategy_does_not_bypass_fake_prose_table_checks():
    table = FakeTable(
        (20, 40, 580, 760),
        30,
        5,
        "| the benefit to | the rea | der is | ordinary | prose |\n"
        "| --- | --- | --- | --- | --- |\n"
        "| revenue manag | ement | keeps gett | ing split | apart |\n"
        "| another para | graph | with ordina | ry words | here |",
    )
    prose = (
        "This is an ordinary long paragraph with enough natural language words to show that "
        "the candidate region is prose rather than a semantic table.\n"
        "A second long sentence provides additional positive prose evidence for the detector.\n"
        "A third long sentence makes the page-wide grid interpretation even less plausible."
    )
    assert extract_tables(FakePage(table, prose)) == []


def test_large_numeric_ruled_table_can_still_be_preserved():
    rows = ["| coefficient | value |", "| --- | --- |"]
    rows.extend(f"| {index} | {index / 10:.1f} |" for index in range(1, 40))
    table = FakeTable((50, 60, 550, 735), 40, 2, "\n".join(rows))
    result = extract_tables(FakePage(table, ""))
    assert len(result) == 1
    assert "| coefficient | value |" in result[0][1]
