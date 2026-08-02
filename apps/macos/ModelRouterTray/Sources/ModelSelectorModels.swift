import Foundation

enum ModelCatalogTab: String, CaseIterable, Identifiable {
  case sota = "SOTA"
  case go = "OpenCode Go"
  case free = "Free"

  var id: String { rawValue }
}

struct ModelSelectorEntry: Identifiable, Equatable {
  let slug: String
  let name: String
  let provider: String
  let pickerVisibility: String
  let enabled: Bool
  let native: Bool
  let family: String

  var id: String { slug }

  init(
    slug: String,
    name: String,
    provider: String,
    pickerVisibility: String,
    enabled: Bool = true,
    native: Bool = false,
    family: String? = nil
  ) {
    self.slug = slug
    self.name = name
    self.provider = provider
    self.pickerVisibility = pickerVisibility
    self.enabled = enabled
    self.native = native
    self.family = family ?? Self.inferredFamily(slug: slug, name: name)
  }

  init(_ model: RouterModel) {
    self.init(
      slug: model.slug,
      name: model.displayName,
      provider: model.provider,
      pickerVisibility: model.pickerVisibility ?? "list",
      enabled: model.enabled,
      native: model.native ?? model.provider == "openai",
      family: model.family
    )
  }

  private static func inferredFamily(slug: String, name: String) -> String {
    let value = "\(slug) \(name)".lowercased()
    let rules = [
      ("deepseek", "DeepSeek"), ("minimax", "MiniMax"),
      ("big-pickle", "Free"), ("qwen", "Qwen"), ("kimi", "Kimi"),
      ("grok", "Grok"), ("mimo", "MiMo"), ("glm", "GLM"),
      ("hy", "HY"), ("gpt", "GPT"),
    ]
    return rules.first(where: { value.contains($0.0) })?.1 ?? "Other"
  }
}

struct ModelSelectorCatalog {
  let models: [ModelSelectorEntry]
  let favoriteSlugs: [String]

  init(models: [ModelSelectorEntry], favorites: [String]) {
    self.models = models
    var seen = Set<String>()
    favoriteSlugs = favorites.filter { seen.insert($0).inserted }
  }

  var favoriteModels: [ModelSelectorEntry] {
    favoriteSlugs.compactMap { slug in models.first(where: { $0.slug == slug }) }
  }

  func models(for tab: ModelCatalogTab, search: String) -> [ModelSelectorEntry] {
    let tabbed = models.filter { model in
      switch tab {
      case .sota: return model.pickerVisibility == "list"
      case .go: return model.provider == "opencode-go"
      case .free: return model.provider == "opencode-free"
      }
    }
    let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let filtered = query.isEmpty ? tabbed : tabbed.filter {
      [$0.name, $0.slug, $0.provider, $0.family]
        .contains(where: { $0.lowercased().contains(query) })
    }
    let favoriteOrder = Dictionary(uniqueKeysWithValues: favoriteSlugs.enumerated().map { ($0.element, $0.offset) })
    return filtered.sorted { left, right in
      let leftFavorite = favoriteOrder[left.slug]
      let rightFavorite = favoriteOrder[right.slug]
      if leftFavorite != nil || rightFavorite != nil {
        if leftFavorite == nil { return false }
        if rightFavorite == nil { return true }
        return leftFavorite! < rightFavorite!
      }
      if left.family != right.family { return left.family < right.family }
      return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
    }
  }
}
