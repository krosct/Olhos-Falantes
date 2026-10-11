from typing import Literal, get_args

Detail = Literal["short", "medium", "long", "full"]

DETAIL_LEVELS: tuple[str, ...] = get_args(Detail)
DEFAULT_DETAIL: Detail = "medium"

_LENGTH_RULE = {
    "short": "no máximo três frases curtas e simples",
    "medium": "no máximo seis frases curtas e simples",
    "long": "no máximo nove frases curtas e simples",
    "full": (
        "uma descrição completa, com o máximo de detalhes possível e riqueza de "
        "informações: cores, materiais, tamanhos, quantidades, posições relativas, "
        "iluminação e todo texto visível, em frases claras e simples"
    ),
}

_NO_PEOPLE_RULE = (
    "- NUNCA identifique pessoas, nomes, rostos, idade, gênero, emoção, etnia ou identidade.\n"
)

_PEOPLE_RULE = (
    "- Se houver pessoas, descreva-as: quantas são, onde estão na cena, roupas, postura "
    "e o que estão fazendo. Use sempre \"pessoa\" ou \"pessoas\".\n"
    "- Mesmo assim, NUNCA identifique quem é a pessoa nem diga nome, idade, gênero, "
    "emoção, etnia ou traços do rosto.\n"
)


def build_prompt(detail: str = DEFAULT_DETAIL, people: bool = False) -> str:
    length = _LENGTH_RULE.get(detail, _LENGTH_RULE[DEFAULT_DETAIL])
    people_rule = _PEOPLE_RULE if people else _NO_PEOPLE_RULE
    return (
        "Você descreve uma cena a partir de uma foto, em português do Brasil, para "
        "uma pessoa cega ou com baixa visão. Responda SOMENTE com um objeto JSON, sem "
        "texto em volta, com exatamente duas chaves: \"description\" e \"confidence\".\n"
        "\n"
        f"- \"description\": {length}. Diga os principais "
        "objetos, como eles estão dispostos no espaço e qualquer texto curto bem visível. "
        "Use linguagem do dia a dia e evite palavras difíceis.\n"
        "- \"confidence\": um número de 0 a 1 dizendo o quão seguro você está da descrição.\n"
        "\n"
        "Regras obrigatórias:\n"
        f"{people_rule}"
        "- Não dê conselhos médicos, legais ou de segurança.\n"
        "- Não invente nem especule nada que não esteja claramente visível na imagem.\n"
        "- Não leia documentos, cartões, telas de banco ou qualquer informação confidencial.\n"
        "- Se a imagem estiver escura, desfocada, vazia ou inutilizável, use "
        "\"description\": \"\" e \"confidence\" menor que 0.2.\n"
        "\n"
        "Responda apenas com o JSON."
    )


FIXED_PROMPT = build_prompt()
