from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import VAPID_PUBLIC_KEY
from ..database import get_db
from ..models import PushSubscription, User
from ..schemas import PushSubscribeIn, PushUnsubscribeIn
from ..security import get_current_user

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/vapid-key")
async def vapid_key():
    return {"public_key": VAPID_PUBLIC_KEY}


@router.post("/subscribe")
async def subscribe(body: PushSubscribeIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sub = (await db.execute(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))).scalar_one_or_none()
    if sub is None:
        sub = PushSubscription(endpoint=body.endpoint, user_id=user.id, p256dh=body.keys.p256dh, auth=body.keys.auth)
        db.add(sub)
    else:
        # Same browser, possibly another account signed in now: the device follows the latest login.
        sub.user_id, sub.p256dh, sub.auth = user.id, body.keys.p256dh, body.keys.auth
    await db.commit()
    return {"ok": True}


@router.delete("/subscribe")
async def unsubscribe(body: PushUnsubscribeIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(
        delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == user.id)
    )
    await db.commit()
    return {"ok": True}
