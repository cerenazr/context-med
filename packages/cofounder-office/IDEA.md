# cofounder-office

Solopreneur'ün tek kişilik ekibini; distile edilmiş **persona-brain**'lerden oluşan, rol-bazlı koordine çalışan ve **Cerebra substrate**'i üstünde birikim üreten yüksek sadakatli bir sanal ofis örüntüsüne dönüştüren brain-package.

Bu proje, bir "çoklu chatbot" kümesi değil; **ai-cofounder**'ın operasyonel gücü ile **colleague-skill**'in distilasyon derinliğini birleştiren profesyonel bir agentic-team framework'üdür.

## Çekirdek Fikir

Solopreneur'ün en büyük yükü olan **"Context-Switching"** (rol değiştirme) maliyetini sıfırlamak. Ofis, solopreneur'ün zihnindeki rolleri (Mimar, Arabulucu, İcracı) kalıcı, tutarlı ve proaktif çalışan bağımsız birimlere dağıtır.

## Mimari ve Bileşenler

Üç katmanlı, event-driven ve proaktif bir yapı mevcuttur:

### 1. Persona Katmanı (High-Fidelity Distillation)
Her persona, **dot-skill** protokolü kullanılarak 6 boyutta distile edilir:
- **6-Track Research**: Eserleri (Works), Konuşmaları (Conversations), İfade DNA'sı (Expression), Karar Modelleri (Decisions), Dış Perspektif (External View) ve Zaman Çizelgesi (Timeline).
- **Persona vs. Work Ayrımı**: Karakterin "sesi" (nasıl dediği) ile "uzmanlığı" (ne yaptığı) ayrı dosyalarda tutulur.
- **Correction Loop**: Kullanıcının "O böyle demez" geri bildirimleri, personanın `correction-log`una yazılarak karakterin zamanla evrilmesini sağlar.

### 2. Operasyonel Şema (Office Schema & DSL)
Ofis, deklaratif bir `office.yml` ile yönetilir:
- **Roster & Hierarchy**: Kimin kime rapor verdiği (`reports_to`) ve yetki alanları.
- **Channels**: #strategy (strateji), #operations (icraat) ve #audit (denetim) gibi özel kanallar üzerinden IPC (Inter-Process Communication).
- **Reality Audit (Shadow Wiki)**: Arabulucu'nun (PM) tuttuğu, Mimar'ın vizyonu ile sahadaki gerçeklik arasındaki farkı raporlayan gizli denetim günlüğü.

### 3. Koordinasyon Motoru (Runtime Engine)
**ai-cofounder** mentalitesinden türetilen motorun görevleri:
- **Tick-Based Scheduler**: Saniyede bir çalışan "kalp atışı" ile inbox'ları tarar, görevleri öncelik sırasına (Priority Queue) göre dağıtır.
- **Task Chaining**: Bir görev bittiğinde (Done), ona bağlı olan (DependsOn) diğer görevleri otomatik olarak tetikler.
- **Watchdog**: Uzun süren sessizlikleri veya takılan task'ları tespit edip alarm üretir.
- **Cron Jobs**: Belirli saatlerde (örn: Pazartesi sabah planlaması) proaktif olarak görev zincirleri başlatır.

## Temel Primitive'ler

- **Persona Skill**: İnsan zihnini distile eden taşınabilir paket.
- **Channel**: Personaların asenkron konuştuğu, geçmişi otomatik olarak wiki'ye yazılan kanallar.
- **Assignment**: Rollerin (PM, Coder) personalara (Zuck-vibe, Mentor-vibe) bağlanması.
- **Provenance Trail**: Her kararın ve kod satırının hangi personadan, hangi veriye dayanılarak çıktığının izlenebilirliği.
- **Heartbeat**: Agent'ların boşta kaldıklarında kendi kendilerini "Check for work" diye uyarması.

## Kullanım Senaryosu (Türk Usulü Plaza Akışı)

1. **Mimar (CVO):** "Arkadaşlar, rakip pivot etmiş, biz de hemen AI işine giriyoruz. Mindset'i değiştirin, yarın sabah demoyu istiyorum." (🚀)
2. **Arabulucu (PM):** (Kortizol tavan) "Mimar Bey harika vizyon! İcracı, yandık bittik! Gözünü seveyim şu işi olduralım. Ben Mimar Bey'e '2 saat' dedim ama senin 1 saatin var." (Shadow Wiki'ye yazar: *Mimar yine imkansızı istedi, risk %90.*)
3. **İcracı (Doer):** "Abi o iş öyle olmaz ama bakıyorum... Spotify API hazır, kodlamaya geçtim." (Log: *Yine mi pivot?*)

## Cerebra Entegrasyonu

Cofounder-office, Cerebra substrate'i üzerinde oturur:
- **Read**: `core-wiki` (şirket hafızası) ve `persona-wiki`lerden beslenir.
- **Write**: Karar notlarını `decisions/`, çıktıları `artifacts/` klasörüne yazar.
- **Ratchet**: Persona'nın ses tonu ve karar kalitesi periyodik olarak otomatik testlerden (Eval set) geçirilir.

## V1 Scope

- 3 temel persona (Mimar, Arabulucu, İcracı).
- Temel `office.yml` operasyonel şeması.
- Basit bir Dashboard (Chat + Reality Audit Log).
- Proaktif Cron (Standup) desteği.
- 6 boyutlu persona distilasyon iskeleti.