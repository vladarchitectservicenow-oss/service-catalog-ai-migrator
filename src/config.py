"""Configuration loader from config.yaml with Pydantic validation."""

from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel, Field


class ServiceNowConfig(BaseModel):
    """ServiceNow instance connection settings."""

    instance_url: str = Field(default="", description="SN instance URL")
    username: str = Field(default="", description="SN username")
    password: str = Field(default="", description="SN password")


class LLMConfig(BaseModel):
    """LLM provider settings."""

    provider: str = Field(default="openai", description="LLM provider")
    api_key: str = Field(default="", description="API key")
    model: str = Field(default="gpt-4o", description="Model name")


class OutputConfig(BaseModel):
    """Output settings."""

    dir: str = Field(default="./output", description="Output directory")
    formats: list[str] = Field(default=["markdown"], description="Output formats")


class DiscoveryConfig(BaseModel):
    """Discovery settings."""

    max_catalog_items: int = Field(default=500, ge=1, le=10000)
    history_days: int = Field(default=365, ge=1, le=3650)
    include_inactive: bool = Field(default=False)


class AppConfig(BaseModel):
    """Full application configuration."""

    servicenow: ServiceNowConfig = Field(default_factory=ServiceNowConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    output: OutputConfig = Field(default_factory=OutputConfig)
    discovery: DiscoveryConfig = Field(default_factory=DiscoveryConfig)


def load_config(path: str = "config.yaml") -> AppConfig:
    """Load and validate configuration from YAML file.

    Args:
        path: Path to config.yaml file.

    Returns:
        Validated AppConfig instance.

    Raises:
        FileNotFoundError: If config file doesn't exist.
    """
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")

    with open(config_path, "r") as f:
        raw = yaml.safe_load(f) or {}

    return AppConfig(**raw)
