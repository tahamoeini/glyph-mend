import os

from pdf_sanitizer.native_stderr import capture_native_stderr


def test_captures_and_classifies_native_stderr():
    with capture_native_stderr(True) as captured:
        os.write(2, b"Image too small to scale!! (2x36 vs min width of 3)\n")
        os.write(2, b"Line cannot be recognized!!\n")
        os.write(2, b"Unexpected native diagnostic\n")

    assert captured is not None
    assert len(captured.known_noise) == 2
    assert captured.unknown == ["Unexpected native diagnostic"]


def test_can_leave_native_stderr_uncaptured():
    with capture_native_stderr(False) as captured:
        pass
    assert captured is None
