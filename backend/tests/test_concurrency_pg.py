"""Concurrency guarantees that need real row locks (PostgreSQL only).

Run with e.g. ``DATABASE_URL=postgres://najik:najik@localhost:5432/najik pytest -m postgres``.
"""

from __future__ import annotations

import threading
import uuid

import pytest
from django.db import connection

from apps.chat import services as chat_services
from apps.chat.models import ConversationMember, Message
from tests.conftest import make_user

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]


def _run_threads(target, count):
    errors: list[BaseException] = []

    def wrapper(i):
        try:
            target(i)
        except BaseException as exc:
            errors.append(exc)
        finally:
            connection.close()

    threads = [threading.Thread(target=wrapper, args=(i,)) for i in range(count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors


def test_concurrent_sends_are_gap_free(settings):
    settings.RATE_LIMITS = {**settings.RATE_LIMITS, "message_burst": "1000/10"}
    alice, bob = make_user("alice"), make_user("bob")
    conv, _ = chat_services.get_or_create_conversation(alice, bob.id)

    def send(i):
        sender = alice if i % 2 else bob
        for _ in range(10):
            chat_services.send_message(sender, conv.id, uuid.uuid4(), body=f"m{i}")

    _run_threads(send, 8)
    seqs = list(
        Message.objects.filter(conversation=conv).order_by("seq").values_list("seq", flat=True)
    )
    assert seqs == list(range(1, 81))
    conv.refresh_from_db()
    assert conv.last_seq == 80
    bob_member = ConversationMember.objects.get(conversation=conv, user=bob)
    assert (
        bob_member.unread_count == Message.objects.filter(conversation=conv, sender=alice).count()
    )


def test_concurrent_idempotent_retries_create_one_message():
    alice, bob = make_user("alice"), make_user("bob")
    conv, _ = chat_services.get_or_create_conversation(alice, bob.id)
    client_id = uuid.uuid4()
    _run_threads(lambda i: chat_services.send_message(alice, conv.id, client_id, body="x"), 6)
    assert Message.objects.filter(sender=alice, client_id=client_id).count() == 1


def test_concurrent_reads_and_sends_keep_unread_exact():
    alice, bob = make_user("alice"), make_user("bob")
    conv, _ = chat_services.get_or_create_conversation(alice, bob.id)

    def work(i):
        for n in range(10):
            if i % 2:
                chat_services.send_message(alice, conv.id, uuid.uuid4(), body="x")
            else:
                chat_services.update_watermarks(bob.id, conv.id, read_seq=n * 3)

    _run_threads(work, 6)
    member = ConversationMember.objects.get(conversation=conv, user=bob)
    expected = (
        Message.objects.filter(conversation=conv, seq__gt=member.read_seq)
        .exclude(sender=bob)
        .count()
    )
    assert member.unread_count == expected
