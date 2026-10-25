"""Sentence beats and delivery notes for the expressive storybook narration."""

from __future__ import annotations

import re


MOOD_DELIVERY = {
    "calm": "Use a smooth, even pitch and an unhurried, easy rhythm.",
    "cozy": "Sound close and comfortable, with a soft, warm pitch and gentle pacing.",
    "curious": "Lift the pitch lightly on discoveries or questions, sounding attentive and inviting.",
    "determined": "Keep a firm, steady rhythm and let resolve rise gently near the end.",
    "disappointed": "Let the pitch dip briefly, then keep the feeling light and safe.",
    "frustrated": "Show a small, child-safe sigh or downward turn, without harshness.",
    "grateful": "Sound sincere and warm, easing into a soft, satisfied finish.",
    "hopeful": "Begin softly and let the pitch rise toward a reassuring possibility.",
    "joyful": "Brighten the pitch and rhythm with a genuine smile, never shouting.",
    "nervous": "Sound gently hesitant, with a small pitch wobble and a careful pause.",
    "playful": "Use a nimble, lightly bouncy pitch and an easy comic rhythm.",
    "proud": "Land the accomplishment with quiet, smiling confidence, not a boast.",
    "reassuring": "Stay steady, warm, and a little lower in pitch so the line feels safe.",
    "relieved": "Release the tension, lift the warmth, and settle into an easy breath.",
    "shy": "Use a small, soft voice with a hesitant but friendly upward lilt.",
    "surprised": "Give the discovery one quick, gentle pitch lift, then settle naturally.",
    "tender": "Soften the volume and pace; keep the pitch warm and affectionate.",
    "thoughtful": "Slow slightly, with a lower reflective pitch and meaningful pauses.",
    "urgent": "Pick up the pace a little while staying clear, kind, and never frightening.",
    "wistful": "Keep a soft, yearning color and a lightly falling pitch.",
    "wonder": "Open the pitch and leave room for quiet awe around the magical detail.",
    "worried": "Lower and slow the pitch gently, showing mild concern without fear.",
    "brave": "Begin grounded, then lift into steady, warm courage.",
}


def split_sentences(text: str) -> list[str]:
    """Split spoken beats, keeping quoted dialogue with its attribution."""
    closing_quotes = '”’"\''
    opening_quotes = '“‘"'
    segments: list[str] = []
    start = 0
    index = 0

    while index < len(text):
        if text[index] not in ".!?…":
            index += 1
            continue

        boundary = index + 1
        while boundary < len(text) and text[boundary] in closing_quotes:
            boundary += 1
        following = boundary
        while following < len(text) and text[following].isspace():
            following += 1

        attribution = boundary > index + 1 and re.match(
            r"[A-Z][a-z]+\s+(?:said|asked|called|whispered|replied|cried|murmured|sighed|shouted|cheered|answered)\b",
            text[following:],
        )

        should_split = following == len(text) or (
            following > boundary
            and (text[following].isupper() or text[following] in opening_quotes)
            and not attribution
        )
        if should_split:
            segment = text[start:boundary].strip()
            if segment:
                segments.append(segment)
            start = following
            index = following
        else:
            index = boundary

    remainder = text[start:].strip()
    if remainder:
        segments.append(remainder)
    return segments
