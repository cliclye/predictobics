from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from backend.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
db_url = settings.get_async_db_url()
engine = create_async_engine(db_url, echo=False, pool_size=5, max_overflow=5)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
