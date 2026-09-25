from nodes.cleaner import clean_and_route_node
from nodes.extractor import _looks_like_garbage, _select_vision_page_indices
from nodes.segmentation import _segment_by_headings, segment_to_json_node
from nodes.translator import _translation_chunks


def _long(value: str) -> str:
    return (value + " ") * 35


def test_thai_text_is_not_treated_as_garbage():
    thai_text = "งานวิจัยนี้ศึกษาการเรียนรู้ภาษาอังกฤษของนักศึกษา " * 30
    assert _looks_like_garbage(thai_text) is False


def test_vision_sampling_covers_front_middle_and_end_of_long_thesis():
    pages = _select_vision_page_indices(120, 24)
    assert len(pages) == 24
    assert pages[:3] == [0, 1, 2]
    assert pages[-1] == 119
    assert any(30 < page < 90 for page in pages)


def test_cleaner_preserves_multilingual_headings_and_paragraphs():
    source = "บทคัดย่อ\n" + _long("เนื้อหาบทคัดย่อ") + "\n\nบทที่ 3 วิธีดำเนินการวิจัย\n" + _long("ขั้นตอนการวิจัย")
    result = clean_and_route_node({"raw_text": source})
    assert "บทที่ 3 วิธีดำเนินการวิจัย\n" in result["cleaned_text"]
    assert result["needs_translation"] is True


def test_thai_thesis_headings_are_segmented_without_article_layout():
    text = "\n\n".join(
        [
            "ชื่อวิทยานิพนธ์",
            "บทคัดย่อ\n" + _long("บทคัดย่อกล่าวถึงวัตถุประสงค์และผลสำคัญ"),
            "บทที่ 1 บทนำ\n" + _long("ความเป็นมาและปัญหาการวิจัย"),
            "บทที่ 3 วิธีดำเนินการวิจัย\n" + _long("ประชากร เครื่องมือ และขั้นตอนการเก็บข้อมูล"),
            "บทที่ 4 ผลการวิเคราะห์ข้อมูล\n" + _long("ผลการวิเคราะห์และข้อค้นพบ"),
            "บทที่ 5 สรุปผลการวิจัย อภิปรายผล และข้อเสนอแนะ\n" + _long("สรุป อภิปราย และข้อเสนอแนะ"),
            "บรรณานุกรม\n" + _long("รายการเอกสารอ้างอิง"),
        ]
    )
    sections = _segment_by_headings(text)
    assert "ประชากร" in sections["methods"]
    assert "ข้อค้นพบ" in sections["results"]
    assert "ข้อเสนอแนะ" in sections["conclusion"]
    assert "รายการเอกสาร" in sections["bibliography"]


def test_long_thesis_sends_only_the_heading_outline_to_the_model(monkeypatch):
    # Any length works: the model sees numbered heading lines, not the text.
    from unittest.mock import MagicMock

    from nodes import segmentation
    from state import SectionOutlineSchema

    text = "บทคัดย่อ\n" + ("ข้อมูล " * 30000) + "\nบทที่ 3 วิธีดำเนินการวิจัย\n" + ("วิธีวิจัย " * 1000)
    llm = MagicMock()
    llm.with_structured_output.return_value.invoke.return_value = SectionOutlineSchema(
        abstract=1, introduction=0, literature_review=0, methods=2, results=0,
        discussion=0, conclusion=0, references=0, back_matter=0,
    )
    monkeypatch.setattr(segmentation, "segmentation_llm", llm)
    result = segment_to_json_node({"cleaned_english_text": text})
    prompt = llm.with_structured_output.return_value.invoke.call_args[0][0]

    assert result["segmentation_strategy"] == "model_outline"
    assert "L1: บทคัดย่อ" in prompt and "L2: บทที่ 3 วิธีดำเนินการวิจัย" in prompt
    assert len(prompt) < 6000
    assert "วิธีวิจัย" in result["final_json"]["methods"]


def test_heading_rules_are_used_when_the_model_fails(monkeypatch):
    from unittest.mock import MagicMock

    from nodes import segmentation

    text = "บทคัดย่อ\n" + ("ข้อมูล " * 300) + "\nวิธีดำเนินการวิจัย\n" + ("วิธีวิจัย " * 100)
    llm = MagicMock()
    llm.with_structured_output.return_value.invoke.side_effect = RuntimeError("offline")
    monkeypatch.setattr(segmentation, "segmentation_llm", llm)
    result = segment_to_json_node({"cleaned_english_text": text})
    assert result["status"] == "segmented"
    assert result["segmentation_strategy"] == "multilingual_headings"
    assert "segmentation" in result["warnings"][0]
    assert "วิธีวิจัย" in result["final_json"]["methods"]


def test_translation_chunks_preserve_all_paragraphs():
    text = "\n\n".join(f"paragraph-{index} " + ("x" * 90) for index in range(20))
    chunks = _translation_chunks(text, max_chars=400)
    assert len(chunks) > 1
    combined = "\n\n".join(chunks)
    for index in range(20):
        assert f"paragraph-{index}" in combined
