from __future__ import annotations

import torch
import torch.nn as nn


def activation_layer(name: str) -> nn.Module:
    if name == "relu":
        return nn.ReLU()
    if name == "tanh":
        return nn.Tanh()
    if name == "identity":
        return nn.Identity()
    raise ValueError(f"Unsupported activation '{name}'")


class FeedForwardNetwork(nn.Module):
    def __init__(
        self,
        input_size: int,
        hidden_sizes: tuple[int, ...],
        output_size: int,
        hidden_activation: str,
        output_activation: str,
    ) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        previous_size = input_size
        for hidden_size in hidden_sizes:
            layers.append(nn.Linear(previous_size, hidden_size))
            layers.append(activation_layer(hidden_activation))
            previous_size = hidden_size
        layers.append(nn.Linear(previous_size, output_size))
        if output_activation != "identity":
            layers.append(activation_layer(output_activation))
        self.network = nn.Sequential(*layers)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.network(inputs)


class SoftmaxExportWrapper(nn.Module):
    def __init__(self, model: nn.Module) -> None:
        super().__init__()
        self.model = model
        self.softmax = nn.Softmax(dim=1)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.softmax(self.model(inputs))
