from pdf_sanitizer.graphics import intersection_area, overlap_ratio, rect_area
from pdf_sanitizer.visual_ir import detect_vector_visual_ir, visual_ir_to_mermaid


class FakePage:
    def __init__(self, drawings, rect=(0.0, 0.0, 200.0, 120.0), text_boxes=None):
        self._drawings = drawings
        self.rect = rect
        self._text_boxes = text_boxes or {}

    def get_drawings(self):
        return self._drawings

    def get_textbox(self, bbox):
        return self._text_boxes.get(tuple(bbox), "")


def test_bbox_math():
    a = (0.0, 0.0, 10.0, 10.0)
    b = (5.0, 5.0, 15.0, 15.0)
    assert rect_area(a) == 100
    assert intersection_area(a, b) == 25
    assert overlap_ratio(a, b) == 0.25


def test_detect_vector_visual_ir_reconstructs_direction_and_labels():
    drawings = [
        {"items": [("re", (10.0, 20.0, 50.0, 44.0)), ("re", (100.0, 20.0, 150.0, 44.0)), ("l", (50.0, 32.0), (100.0, 32.0))]},
    ]
    page = FakePage(drawings, text_boxes={
        (10.0, 20.0, 50.0, 44.0): "Start",
        (100.0, 20.0, 150.0, 44.0): "End",
    })

    visuals = detect_vector_visual_ir(page)
    assert len(visuals) == 1
    visual_ir = visuals[0]
    assert visual_ir["kind"] == "flowchart"
    assert [node["label"] for node in visual_ir["nodes"]] == ["Start", "End"]
    assert visual_ir["geometry"]["direction"] == "LR"
    assert visual_ir_to_mermaid(visual_ir).startswith("```mermaid")


def test_detect_vector_visual_ir_keeps_disconnected_nodes_and_warnings():
    drawings = [
        {"items": [("re", (10.0, 10.0, 40.0, 34.0)), ("re", (100.0, 10.0, 130.0, 34.0))]},
    ]
    page = FakePage(drawings, text_boxes={
        (10.0, 10.0, 40.0, 34.0): "One",
        (100.0, 10.0, 130.0, 34.0): "Two",
    })

    visual_ir = detect_vector_visual_ir(page)[0]
    assert len(visual_ir["nodes"]) == 2
    assert visual_ir["edges"] == []
    assert any("No connector topology confirmed" in warning for warning in visual_ir["warnings"])


def test_detect_vector_visual_ir_marks_ambiguous_arrowheads():
    drawings = [
        {"items": [("re", (10.0, 20.0, 45.0, 44.0)), ("re", (105.0, 20.0, 140.0, 44.0)), ("l", (45.0, 32.0), (80.0, 32.0)), ("l", (80.0, 32.0), (105.0, 32.0)), ("l", (45.0, 32.0), (50.0, 27.0)), ("l", (45.0, 32.0), (50.0, 37.0)), ("l", (105.0, 32.0), (100.0, 27.0)), ("l", (105.0, 32.0), (100.0, 37.0))]},
    ]
    page = FakePage(drawings, text_boxes={
        (10.0, 20.0, 45.0, 44.0): "Source",
        (105.0, 20.0, 140.0, 44.0): "Target",
    })

    visual_ir = detect_vector_visual_ir(page)[0]
    assert visual_ir["edges"] == []
    assert any("ambiguous" in warning.lower() for warning in visual_ir["warnings"])


def test_mermaid_serialization_sanitizes_untrusted_labels_ids_edges_and_direction():
    visual_ir = {
        "geometry": {"direction": 'LR\n%%{init: {"securityLevel": "loose"}}%%'},
        "nodes": [
            {
                "id": 'unsafe"]\nclick N1 "javascript:alert(1)',
                "label": '<script>alert(1)</script> | bad; %%{init}%%',
                "shape": "box",
            },
            {"id": "target", "label": "End", "shape": "box"},
        ],
        "edges": [
            {
                "from": 'unsafe"]\nclick N1 "javascript:alert(1)',
                "to": "target",
                "directed": True,
                "label": "edge | click N1 javascript:alert(1);",
            }
        ],
    }

    markdown = visual_ir_to_mermaid(visual_ir)
    assert markdown.startswith("```mermaid\nflowchart LR\n")
    assert "<script" not in markdown
    assert "click N1" not in markdown
    assert "securityLevel" not in markdown
    assert 'N1["' in markdown
    assert "N1 -->|edge click N1 javascript:alert(1)| N2" in markdown
