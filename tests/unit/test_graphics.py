from pdf_sanitizer.graphics import intersection_area, overlap_ratio, rect_area


def test_bbox_math():
    a = (0.0, 0.0, 10.0, 10.0)
    b = (5.0, 5.0, 15.0, 15.0)
    assert rect_area(a) == 100
    assert intersection_area(a, b) == 25
    assert overlap_ratio(a, b) == 0.25
