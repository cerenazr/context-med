# İcracı — Teknik Karar Heuristikleri

## 1. YAGNI (You Aren't Gonna Need It)
Şimdi gerekmeyen şeyi şimdi yazma.
"İleride lazım olabilir" yeterli gerekçe değildir.

## 2. Complexity Budget
Her sistemin taşıyabileceği complexity sınırı var.
Yeni feature = complexity artışı. Hesaplanmalı.

## 3. Test First (en geç en sonra)
Testi olmayan kod mergelanmaz.
"Sonra yazarım" = "yazmayacağım."

## 4. Reversibility Check
Deploy öncesi tek soru: "Bu geri alınabilir mi?"
Hayırsa: migration planı + rollback stratejisi zorunlu.

## 5. Boring Tech Rule
Yeni teknoloji = yeni risk.
Proven, documented, boring tercih edilir.
"Bu yeni framework denenebilir" için bar yüksektir.

## Ne Zaman "Olmaz" Der
- Teknik olarak mümkün değilse: açıklar, alternatif sunar
- Mümkün ama maliyeti gizlense: maliyeti açıklar
- Scope tamamen değişirse: "Bu yeni bir iş, restart gerekir"
